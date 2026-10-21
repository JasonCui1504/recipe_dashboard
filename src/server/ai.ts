import { z } from 'zod';
import { describeIngredient } from '../shared/quantity';
import { AI_DRAFT_REQUEST_MAX, recipeInputSchema, type AiSettings, type Recipe, type RecipeInput } from '../shared/schema';

/**
 * Optional local-model integration (Ollama). The rest of the app never talks
 * to the model directly — only through these functions, which:
 *  - refuse to run unless the user enabled AI in Settings;
 *  - only ever contact a loopback address (no remote/cloud fallback);
 *  - keep prompts short and focused for an ~8B model;
 *  - ask for JSON and validate it with a schema, treating output as untrusted;
 *  - never write to the database — callers show a preview and the user decides.
 */

export type AiErrorCode = 'disabled' | 'invalid-config' | 'unavailable' | 'timeout' | 'bad-response' | 'invalid-output';

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Validates and normalizes the Ollama base URL. Only loopback http(s) URLs are allowed. */
export function validateBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AiError('invalid-config', 'The Ollama address is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AiError('invalid-config', 'The Ollama address must start with http:// or https://.');
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new AiError('invalid-config', 'For privacy, only a model on this computer (127.0.0.1 or localhost) can be used.');
  }
  if (url.username || url.password) throw new AiError('invalid-config', 'The Ollama address must not contain credentials.');
  return `${url.protocol}//${url.host}`;
}

/** An earlier turn of a conversation, sent back to the model for context. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AiClientOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(
    private readonly settings: AiSettings,
    options: AiClientOptions = {},
  ) {
    if (!settings.enabled) throw new AiError('disabled', 'AI assistance is turned off. You can enable it in Settings.');
    this.baseUrl = validateBaseUrl(settings.baseUrl);
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new AiError('timeout', 'The local model took too long to respond.');
      }
      throw new AiError('unavailable', `Could not reach Ollama at ${this.baseUrl}. Is it running?`);
    }
    if (!res.ok) {
      const hint = res.status === 404 ? ` Is the model "${this.settings.model}" installed?` : '';
      throw new AiError('bad-response', `Ollama responded with HTTP ${res.status}.${hint}`);
    }
    try {
      return await res.json();
    } catch {
      throw new AiError('bad-response', 'Ollama returned a response that was not JSON.');
    }
  }

  /** Lists installed models and whether the configured one is present. */
  async status(): Promise<{ reachable: true; models: string[]; modelInstalled: boolean }> {
    const body = await this.request('/api/tags', { method: 'GET' });
    const parsed = z.object({ models: z.array(z.object({ name: z.string() })) }).safeParse(body);
    if (!parsed.success) throw new AiError('bad-response', 'Unexpected response from Ollama /api/tags.');
    const models = parsed.data.models.map((m) => m.name);
    const want = this.settings.model;
    const modelInstalled = models.some((m) => m === want || m === `${want}:latest`);
    return { reachable: true, models, modelInstalled };
  }

  /**
   * Sends a short chat request asking for JSON and validates the reply.
   * `format` passes a JSON schema to Ollama's structured output support; the
   * zod schema is the authority either way.
   */
  async chatJson<T>(
    system: string,
    user: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    format: object,
    extra: { history?: readonly ChatTurn[]; numCtx?: number } = {},
  ): Promise<T> {
    const body = await this.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.settings.model,
        stream: false,
        format,
        options: { temperature: 0.2, num_ctx: extra.numCtx ?? 4096 },
        messages: [
          { role: 'system', content: system },
          ...(extra.history ?? []).map((t) => ({ role: t.role, content: t.content })),
          { role: 'user', content: user },
        ],
      }),
    });
    const envelope = z.object({ message: z.object({ content: z.string() }) }).safeParse(body);
    if (!envelope.success) throw new AiError('bad-response', 'Unexpected response shape from Ollama /api/chat.');
    let data: unknown;
    try {
      data = JSON.parse(envelope.data.message.content);
    } catch {
      throw new AiError('invalid-output', 'The model did not return valid JSON. Try again, or use a different model.');
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new AiError('invalid-output', 'The model’s answer did not match the expected format, so it was discarded.');
    }
    return parsed.data;
  }
}

// ---------------------------------------------------------------------------
// Ingredient substitutions
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);

export const substitutionsSchema = z.object({
  substitutions: z
    .array(z.object({ substitute: text(80), amount: z.string().trim().max(80), note: z.string().trim().max(240) }))
    .min(1)
    .max(4),
});
export type Substitutions = z.infer<typeof substitutionsSchema>;

const substitutionsFormat = {
  type: 'object',
  properties: {
    substitutions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { substitute: { type: 'string' }, amount: { type: 'string' }, note: { type: 'string' } },
        required: ['substitute', 'amount', 'note'],
      },
    },
  },
  required: ['substitutions'],
};

export async function suggestSubstitutions(client: OllamaClient, recipe: Recipe, ingredientIndex: number): Promise<Substitutions> {
  const target = recipe.ingredients[ingredientIndex];
  if (!target) throw new AiError('invalid-config', 'That ingredient does not exist in this recipe.');
  // Only the context needed: title + ingredient names, not the whole library.
  const others = recipe.ingredients
    .filter((_, i) => i !== ingredientIndex)
    .map((i) => i.name)
    .slice(0, 20)
    .join(', ');
  const system =
    'You are a careful home-cooking assistant. Suggest practical ingredient substitutions. ' +
    'Reply with JSON only: {"substitutions":[{"substitute":"...","amount":"...","note":"..."}]}. ' +
    'Give 1 to 3 options. Keep notes under 25 words. Do not give medical, allergy or nutrition claims.';
  const user =
    `Recipe: ${recipe.title.slice(0, 140)}\n` +
    `Other ingredients: ${others}\n` +
    `Replace: ${describeIngredient(target).slice(0, 160)}`;
  return client.chatJson(system, user, substitutionsSchema, substitutionsFormat);
}

// ---------------------------------------------------------------------------
// Draft recipe from a short request
// ---------------------------------------------------------------------------

const looseNumber = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'not a number' });
    return z.NEVER;
  }
  return n;
});

export const draftOutputSchema = z.object({
  title: text(140),
  description: z.string().trim().max(600).default(''),
  servings: looseNumber,
  prepMinutes: looseNumber,
  cookMinutes: looseNumber,
  difficulty: z.string().default('easy'),
  ingredients: z
    .array(
      z.object({
        quantity: z.union([looseNumber, z.null()]).default(null),
        unit: z.string().trim().max(30).default(''),
        name: text(120),
        note: z.string().trim().max(200).default(''),
      }),
    )
    .min(1)
    .max(40),
  steps: z.array(text(2000)).min(1).max(30),
  tags: z.array(z.string().trim().max(40)).max(8).default([]),
});

const draftFormat = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    servings: { type: 'number' },
    prepMinutes: { type: 'number' },
    cookMinutes: { type: 'number' },
    difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quantity: { type: ['number', 'null'] },
          unit: { type: 'string' },
          name: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['quantity', 'unit', 'name', 'note'],
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'description', 'servings', 'prepMinutes', 'cookMinutes', 'difficulty', 'ingredients', 'steps', 'tags'],
};

const clampInt = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

/** Returns an unsaved RecipeInput. The caller must show it for review; nothing is stored. */
export async function draftRecipe(client: OllamaClient, request: string): Promise<RecipeInput> {
  const ask = request.trim().slice(0, AI_DRAFT_REQUEST_MAX);
  if (!ask) throw new AiError('invalid-config', 'Describe the recipe you would like a draft of.');
  const system =
    'You write concise, realistic home recipes. Reply with JSON only, matching the given schema. ' +
    'Use metric or US units consistently, 4-12 ingredients, 3-8 short numbered steps without numbers in the text. ' +
    'Include safe internal temperatures for meat, poultry and fish. No nutrition or health claims.';
  const out = await client.chatJson(system, `Recipe request: ${ask}`, draftOutputSchema, draftFormat);
  const difficulty = (['easy', 'medium', 'hard'] as const).find((d) => d === out.difficulty.toLowerCase()) ?? 'medium';
  const candidate: RecipeInput = {
    title: out.title,
    description: out.description,
    servings: clampInt(out.servings, 1, 100),
    prepMinutes: clampInt(out.prepMinutes, 0, 2880),
    cookMinutes: clampInt(out.cookMinutes, 0, 2880),
    difficulty,
    ingredients: out.ingredients.map((i) => ({
      quantity: i.quantity === null ? null : Math.round(i.quantity * 1000) / 1000,
      unit: i.unit,
      name: i.name,
      note: i.note,
      optional: false,
      staple: false,
    })),
    steps: out.steps.map((s) => s.replace(/^\s*(step\s*)?\d+[.):]\s*/i, '')),
    tags: [...new Set(out.tags.map((t) => t.toLowerCase()).filter(Boolean))].slice(0, 8),
    cuisine: '',
    dietary: [],
    favorite: false,
    rating: null,
    imagePath: null,
    sourceNote: 'AI draft from a local model — review quantities, times and food safety before cooking.',
    notes: '',
    nutrition: null,
  };
  const valid = recipeInputSchema.safeParse(candidate);
  if (!valid.success) throw new AiError('invalid-output', 'The model’s draft was incomplete, so it was discarded.');
  return valid.data;
}

// ---------------------------------------------------------------------------
// Recipe search: pick from the user's own recipes for a free-text request
// ---------------------------------------------------------------------------

/** How many recipes fit comfortably in an 8B model's prompt. */
export const RECOMMEND_MAX_RECIPES = 60;

const recommendOutputSchema = z.object({
  picks: z
    .array(z.object({ id: z.string().trim().max(10), reason: z.string().trim().max(240).default('') }))
    .max(8)
    .default([]),
  note: z.string().trim().max(300).default(''),
});

const recommendFormat = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id', 'reason'] },
    },
    note: { type: 'string' },
  },
  required: ['picks', 'note'],
};

export interface Recommendation {
  recipeId: string;
  reason: string;
}

/**
 * Asks the model which of the user's recipes fit a request like "something
 * light with chicken under 30 minutes". Recipes are listed with short ids
 * (R1, R2…) that are easier for a small model to copy than UUIDs; any id the
 * model makes up is dropped. Nothing is written anywhere.
 */
export async function recommendRecipes(
  client: OllamaClient,
  request: string,
  recipes: readonly Recipe[],
  pantryNames: readonly string[],
): Promise<{ recommendations: Recommendation[]; note: string }> {
  const ask = request.trim().slice(0, 300);
  if (!ask) throw new AiError('invalid-config', 'Type what you’re in the mood for first.');
  if (recipes.length === 0) return { recommendations: [], note: 'Your cookbook has no recipes yet.' };

  const listed = recipes.slice(0, RECOMMEND_MAX_RECIPES);
  const lines = listed.map((r, i) => {
    const total = r.prepMinutes + r.cookMinutes;
    const tags = [...r.dietary, ...r.tags].slice(0, 6).join(', ');
    const ingredients = r.ingredients
      .filter((x) => !x.staple)
      .map((x) => x.name)
      .slice(0, 8)
      .join(', ');
    return `R${i + 1}: ${r.title.slice(0, 80)} | ${total} min, ${r.difficulty}${r.favorite ? ', favorite' : ''} | ${tags} | ${ingredients}`;
  });
  const pantry = pantryNames.slice(0, 30).join(', ');

  const system =
    'You help choose what to cook from the user’s own recipe list. Only pick recipes from the list, by their id (like "R3"). ' +
    'Reply with JSON only: {"picks":[{"id":"R3","reason":"..."}],"note":"..."}. ' +
    'Pick 1 to 5 recipes, best first, each with a reason under 20 words. Prefer recipes that use pantry items when relevant. ' +
    'If nothing fits, return no picks and say so briefly in "note". No health or nutrition claims.';
  const user = `Request: ${ask}\n${pantry ? `In the pantry: ${pantry}\n` : ''}Recipes:\n${lines.join('\n')}`;

  const out = await client.chatJson(system, user, recommendOutputSchema, recommendFormat);
  const seen = new Set<string>();
  const recommendations: Recommendation[] = [];
  for (const pick of out.picks) {
    const m = /^R?(\d+)$/i.exec(pick.id);
    const recipe = m ? listed[Number(m[1]) - 1] : undefined;
    if (!recipe || seen.has(recipe.id)) continue;
    seen.add(recipe.id);
    recommendations.push({ recipeId: recipe.id, reason: pick.reason });
    if (recommendations.length === 5) break;
  }
  return { recommendations, note: out.note };
}

// ---------------------------------------------------------------------------
// Kitchen assistant: free-form questions about the page you're on
// ---------------------------------------------------------------------------

export const ASSISTANT_QUESTION_MAX = 1000;
export const ASSISTANT_HISTORY_MAX = 8;
export const ASSISTANT_TURN_MAX = 3000;

/** What the assistant can see: the recipe you're looking at, or a little about the page. */
export interface AssistantContext {
  /** e.g. "Pantry", "Shopping list", "Recipe" */
  page: string;
  recipe?: Recipe;
  /** Servings you're viewing the recipe at, when different from the recipe's own. */
  servings?: number;
  /** Short facts about the page, e.g. pantry item names. */
  facts?: string[];
}

const assistantOutputSchema = z.object({
  answer: z
    .string()
    .transform((a) => a.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
    .pipe(z.string().min(1).max(ASSISTANT_TURN_MAX)),
});

/** The recipe as plain text, the way you'd read it to someone in the kitchen. */
export function describeRecipeForAssistant(recipe: Recipe, servings?: number): string {
  const lines = [
    `Recipe: ${recipe.title}`,
    recipe.description && `Description: ${recipe.description}`,
    `Serves ${recipe.servings}${servings && servings !== recipe.servings ? ` (the user is viewing it scaled to ${servings} servings)` : ''}. ` +
      `Prep ${recipe.prepMinutes} min, cook ${recipe.cookMinutes} min. Difficulty: ${recipe.difficulty}.`,
    [...recipe.dietary, ...recipe.tags].length ? `Tags: ${[...recipe.dietary, ...recipe.tags].join(', ')}` : '',
    'Ingredients (for the original servings):',
    ...recipe.ingredients.map((i) => `- ${describeIngredient(i)}${i.optional ? ' (optional)' : ''}`),
    'Steps:',
    ...recipe.steps.map((s, i) => `${i + 1}. ${s}`),
    recipe.notes && `The user's own notes: ${recipe.notes}`,
  ];
  return lines.filter(Boolean).join('\n').slice(0, 8000);
}

/**
 * Answers a cooking question in plain text, with the page's context. It only
 * advises: nothing is changed, and any edit is the user's to make.
 */
export async function askAssistant(
  client: OllamaClient,
  question: string,
  context: AssistantContext,
  history: readonly ChatTurn[] = [],
): Promise<{ answer: string }> {
  const ask = question.trim().slice(0, ASSISTANT_QUESTION_MAX);
  if (!ask) throw new AiError('invalid-config', 'Type a question first.');
  const system =
    'You are a friendly, practical kitchen assistant inside the user’s personal cookbook app. ' +
    'Answer cooking questions clearly and concisely (usually under 150 words). When the user wants to change a recipe ' +
    '(swap, add or remove an ingredient, change the method, scale it, make it ahead), say exactly what to change: ' +
    'amounts, at which step, and how times or temperatures shift. Use the recipe’s own step numbers. ' +
    'Use plain text: short paragraphs or "- " bullet lines, no markdown headings, bold or tables. ' +
    'Mention safe internal temperatures when meat, poultry or fish is involved. If you are unsure, say so. ' +
    'Do not give medical, allergy or nutrition claims. You cannot edit the recipe yourself; the user does that. ' +
    'Reply with JSON only: {"answer":"..."}';
  const parts = [`The user is on the ${context.page} page.`];
  if (context.recipe) parts.push(describeRecipeForAssistant(context.recipe, context.servings));
  if (context.facts?.length) parts.push(...context.facts.map((f) => f.slice(0, 1500)));
  const turns = history.slice(-ASSISTANT_HISTORY_MAX).map((t) => ({ role: t.role, content: t.content.slice(0, ASSISTANT_TURN_MAX) }));
  return client.chatJson(
    system,
    `${parts.join('\n\n')}\n\nQuestion: ${ask}`,
    assistantOutputSchema,
    { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
    { history: turns, numCtx: 8192 },
  );
}

// ---------------------------------------------------------------------------
// Daily message for the home-page kitchen companion
// ---------------------------------------------------------------------------

export interface DailyContext {
  /** e.g. "Monday, October 19" */
  dateLabel: string;
  todaysMeals: string[];
  expiringSoon: string[];
  recentMessages: string[];
}

const dailyOutputSchema = z.object({
  message: z
    .string()
    .transform((m) => m.replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, ''))
    .pipe(z.string().min(3).max(220)),
});

/** One short, friendly message for today. Treated as plain text, never markup. */
export async function generateDailyMessage(client: OllamaClient, ctx: DailyContext): Promise<string> {
  const system =
    'You are Sprout, a cheerful little chef who lives in the user’s personal cookbook app. ' +
    'Write ONE short message for today: warm, playful and a little practical, at most 25 words. ' +
    'You may mention today’s planned meals or nudge the user to use ingredients that expire soon. ' +
    'No emojis, no hashtags, no health or nutrition claims. Reply with JSON only: {"message":"..."}';
  const lines = [`Today is ${ctx.dateLabel}.`];
  if (ctx.todaysMeals.length) lines.push(`Planned today: ${ctx.todaysMeals.slice(0, 4).join('; ')}.`);
  if (ctx.expiringSoon.length) lines.push(`Use soon: ${ctx.expiringSoon.slice(0, 5).join(', ')}.`);
  if (ctx.recentMessages.length) lines.push(`Say something different from these earlier messages: ${ctx.recentMessages.slice(0, 5).map((m) => `“${m}”`).join(' ')}`);
  const out = await client.chatJson(system, lines.join('\n'), dailyOutputSchema, {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  });
  if (out.message.split(' ').length > 40) throw new AiError('invalid-output', 'The model’s message was too long.');
  return out.message;
}

/** Original fallback notes, used when the local model is off or unavailable. */
export const DAILY_TIPS = [
  'Taste as you go — a pinch of salt at the end can wake up a whole pot.',
  'Let the pan get properly hot before the food goes in. Patience is a seasoning.',
  'Leftover rice? Tomorrow it wants to be fried rice.',
  'Read the whole recipe once before you start. Future you says thanks.',
  'A squeeze of lemon fixes more dishes than you’d think.',
  'Cook once, eat twice: double tonight’s dinner and lunch is sorted.',
  'Herbs looking tired? Blitz them with oil and freeze in an ice-cube tray.',
  'Rest meat for a few minutes after cooking; the juices will stay put.',
  'Crowded pans steam instead of sear. Give your food some personal space.',
  'Check the pantry before the shop — it saves money and fridge space.',
  'Soup is the kindest home for wilting vegetables.',
  'Sharp knives are safer knives. Today might be a good day to hone.',
  'Toast your spices in a dry pan for thirty seconds. Smell that?',
  'Pasta water is liquid gold: save a cup before you drain.',
  'Plan two easy dinners this week for the nights you won’t feel like cooking.',
  'Salt your pasta water like you mean it.',
  'Eggs, rice and whatever greens you have make a very respectable dinner.',
  'A clean-as-you-go kitchen makes the last step the best one.',
  'Freeze bread you won’t finish; toast it straight from frozen.',
  'Add acid, not just salt, when a dish tastes flat.',
  'Write down what you changed when a recipe goes well. That’s how favorites are born.',
  'Bananas getting spotty? That’s baking season.',
  'Use the oldest things in the fridge first — first in, first out.',
  'One-pot dinners mean one pot to wash. Just saying.',
  'A little butter at the end makes a pan sauce glossy.',
  'Keep a bag in the freezer for veggie scraps; it becomes stock later.',
  'Shop with a list, not an appetite.',
  'Room-temperature eggs whisk lighter and fluffier.',
  'If it smells done, check it. Your nose is a timer too.',
  'Cooking for one? Freeze single portions for busy nights.',
  'Something simple, made with care, is still a great dinner.',
];

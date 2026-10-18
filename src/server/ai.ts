import { z } from 'zod';
import { describeIngredient } from '../shared/quantity';
import { recipeInputSchema, type AiSettings, type Recipe, type RecipeInput } from '../shared/schema';

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
  async chatJson<T>(system: string, user: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, format: object): Promise<T> {
    const body = await this.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.settings.model,
        stream: false,
        format,
        options: { temperature: 0.2, num_ctx: 4096 },
        messages: [
          { role: 'system', content: system },
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
  const ask = request.trim().slice(0, 400);
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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiError, askAssistant, DAILY_TIPS, draftRecipe, generateDailyMessage, OllamaClient, recommendRecipes, reviewRecipeHealth, suggestSubstitutions, validateBaseUrl } from '../src/server/ai';
import { recipeInputSchema } from '../src/shared/schema';
import { ing, recipe } from './helpers';
import { startMockOllama, type MockOllama } from './mock-ollama';

let mock: MockOllama;
beforeAll(async () => {
  mock = await startMockOllama();
});
afterAll(() => mock.close());

const client = (overrides: Partial<{ enabled: boolean; baseUrl: string; model: string }> = {}, timeoutMs = 2000) =>
  new OllamaClient({ enabled: true, baseUrl: mock.url, model: 'llama3.1:8b', ...overrides }, { timeoutMs });

const code = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (err) {
    if (err instanceof AiError) return err.code;
    throw err;
  }
  return 'no-error';
};

describe('configuration safety', () => {
  it('is disabled unless explicitly enabled', async () => {
    expect(await code(() => client({ enabled: false }))).toBe('disabled');
  });
  it('only allows loopback addresses (no remote fallback)', () => {
    expect(validateBaseUrl('http://127.0.0.1:11434/')).toBe('http://127.0.0.1:11434');
    expect(validateBaseUrl('http://localhost:11434')).toBe('http://localhost:11434');
    expect(validateBaseUrl('http://[::1]:11434')).toBe('http://[::1]:11434');
    for (const bad of ['https://api.example.com', 'http://192.168.1.20:11434', 'http://127.0.0.1.evil.com', 'file:///etc/passwd', 'not a url', 'http://user:pw@localhost:1']) {
      expect(() => validateBaseUrl(bad)).toThrow(AiError);
    }
  });
});

describe('Ollama client against a mock server', () => {
  it('reports status and installed models', async () => {
    expect(await client().status()).toEqual({ reachable: true, models: ['llama3.1:8b', 'mistral:latest'], modelInstalled: true });
    expect((await client({ model: 'mistral' }).status()).modelInstalled).toBe(true);
    expect((await client({ model: 'qwen' }).status()).modelInstalled).toBe(false);
  });

  it('returns validated substitutions and sends a short, focused prompt', async () => {
    mock.reply({ substitutions: [{ substitute: 'Greek yogurt', amount: '1/4 cup', note: 'Tangier.' }] });
    const r = recipe({ ingredients: [ing(0.25, 'cup', 'sour cream'), ing(2, '', 'eggs')] });
    const subs = await suggestSubstitutions(client(), r, 0);
    expect(subs.substitutions[0].substitute).toBe('Greek yogurt');
    const req = mock.requests.at(-1)!;
    expect(req.path).toBe('/api/chat');
    const body = req.body as { model: string; stream: boolean; format: unknown; messages: Array<{ content: string }> };
    expect(body.model).toBe('llama3.1:8b');
    expect(body.stream).toBe(false);
    expect(body.format).toBeTypeOf('object');
    const prompt = body.messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('sour cream');
    expect(prompt.length).toBeLessThan(1200);
  });

  it('rejects malformed JSON from the model', async () => {
    mock.reply('Sure! Here are some ideas: {not json');
    expect(await code(suggestSubstitutions(client(), recipe(), 0))).toBe('invalid-output');
  });

  it('rejects JSON that does not match the schema', async () => {
    mock.reply({ substitutions: 'use lemon' });
    expect(await code(suggestSubstitutions(client(), recipe(), 0))).toBe('invalid-output');
    mock.reply({ substitutions: [] });
    expect(await code(suggestSubstitutions(client(), recipe(), 0))).toBe('invalid-output');
  });

  it('reports HTTP errors and timeouts', async () => {
    mock.setStatus(500);
    expect(await code(client().status())).toBe('bad-response');
    mock.setStatus(200);
    mock.setDelay(300);
    expect(await code(client({}, 50).status())).toBe('timeout');
    mock.setDelay(0);
  });

  it('reports an unreachable server', async () => {
    // Port 9 on loopback: nothing listens there in the sandbox.
    expect(await code(client({ baseUrl: 'http://127.0.0.1:9' }).status())).toBe('unavailable');
  });

  it('turns a draft into a valid, unsaved RecipeInput', async () => {
    mock.reply({
      title: 'Lemon Chicken Skillet',
      description: 'Bright and quick.',
      servings: '2',
      prepMinutes: 10,
      cookMinutes: 20.4,
      difficulty: 'Easy',
      ingredients: [
        { quantity: 2, unit: '', name: 'chicken thighs', note: '' },
        { quantity: null, unit: '', name: 'salt', note: 'to taste' },
      ],
      steps: ['1. Season the chicken.', 'Step 2: Cook to 74°C / 165°F.'],
      tags: ['Dinner', 'dinner', 'quick'],
    });
    const draft = await draftRecipe(client(), 'lemon chicken');
    expect(recipeInputSchema.safeParse(draft).success).toBe(true);
    expect(draft).toMatchObject({ servings: 2, cookMinutes: 20, difficulty: 'easy', tags: ['dinner', 'quick'] });
    expect(draft.steps).toEqual(['Season the chicken.', 'Cook to 74°C / 165°F.']);
    expect(draft.sourceNote).toMatch(/AI draft/);
  });

  it('treats model text as data — markup is kept as plain text, never interpreted', async () => {
    mock.reply({ substitutions: [{ substitute: '<img src=x onerror=alert(1)>', amount: '', note: '' }] });
    const subs = await suggestSubstitutions(client(), recipe(), 0);
    expect(subs.substitutions[0].substitute).toBe('<img src=x onerror=alert(1)>');
  });

  it('discards an incomplete draft', async () => {
    mock.reply({ title: 'Nothing', servings: 2, prepMinutes: 1, cookMinutes: 1, difficulty: 'easy', ingredients: [], steps: [], tags: [] });
    expect(await code(draftRecipe(client(), 'anything'))).toBe('invalid-output');
  });

  it('recommends from the user’s own recipes, dropping made-up or duplicate ids', async () => {
    const recipes = [
      recipe({ id: 'uuid-a', title: 'Lemon Chicken', ingredients: [ing(2, '', 'chicken thighs'), ing(1, '', 'lemon')] }),
      recipe({ id: 'uuid-b', title: 'Spinach Pasta', ingredients: [ing(200, 'g', 'pasta'), ing(2, 'cups', 'spinach')] }),
    ];
    mock.reply({
      picks: [
        { id: 'R2', reason: 'Uses your spinach.' },
        { id: 'R9', reason: 'Does not exist.' },
        { id: 'R2', reason: 'Duplicate.' },
        { id: 'uuid-a', reason: 'Not a listed id.' },
        { id: '1', reason: 'Quick chicken.' },
      ],
      note: '',
    });
    const r = await recommendRecipes(client(), 'something with spinach', recipes, ['spinach', 'eggs']);
    expect(r.recommendations).toEqual([
      { recipeId: 'uuid-b', reason: 'Uses your spinach.' },
      { recipeId: 'uuid-a', reason: 'Quick chicken.' },
    ]);
    const prompt = (mock.requests.at(-1)!.body as { messages: Array<{ content: string }> }).messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('R1: Lemon Chicken');
    expect(prompt).toContain('In the pantry: spinach, eggs');
    expect(prompt).not.toContain('uuid-');
  });

  it('handles an empty answer and malformed output from the recommender', async () => {
    mock.reply({ picks: [], note: 'Nothing in your recipes is vegan dessert.' });
    expect(await recommendRecipes(client(), 'vegan dessert', [recipe()], [])).toEqual({ recommendations: [], note: 'Nothing in your recipes is vegan dessert.' });
    mock.reply('{"picks": [oops');
    expect(await code(recommendRecipes(client(), 'soup', [recipe()], []))).toBe('invalid-output');
    expect(await code(recommendRecipes(client(), '   ', [recipe()], []))).toBe('invalid-config');
  });

  it('generates a short daily message with today’s context, and rejects bad ones', async () => {
    mock.reply({ message: '  "Lemon chicken tonight — and those eggs won’t eat themselves!"  ' });
    const msg = await generateDailyMessage(client(), {
      dateLabel: 'Monday, October 19',
      todaysMeals: ['dinner: Lemon Chicken'],
      expiringSoon: ['eggs'],
      recentMessages: ['Yesterday’s note.'],
    });
    expect(msg).toBe('Lemon chicken tonight — and those eggs won’t eat themselves!');
    const prompt = (mock.requests.at(-1)!.body as { messages: Array<{ content: string }> }).messages[1].content;
    expect(prompt).toContain('Monday, October 19');
    expect(prompt).toContain('dinner: Lemon Chicken');
    expect(prompt).toContain('Use soon: eggs');
    expect(prompt).toContain('Yesterday’s note.');

    mock.reply({ message: 'word '.repeat(60) });
    expect(await code(generateDailyMessage(client(), { dateLabel: 'x', todaysMeals: [], expiringSoon: [], recentMessages: [] }))).toBe('invalid-output');
    mock.reply({ note: 'no message' });
    expect(await code(generateDailyMessage(client(), { dateLabel: 'x', todaysMeals: [], expiringSoon: [], recentMessages: [] }))).toBe('invalid-output');
    expect(DAILY_TIPS.length).toBeGreaterThanOrEqual(28);
  });
});

describe('kitchen assistant', () => {
  it('answers with the recipe and the earlier conversation as context', async () => {
    mock.reply({ answer: '  Add sliced mushrooms at step 2.\r\n\n\n\nCook 5 minutes more.  ' });
    const r = recipe({ title: 'Garlic Pasta', notes: 'Kids like it mild.', steps: ['Boil pasta.', 'Fry garlic in oil.'] });
    const out = await askAssistant(client(), 'How do I add mushrooms?', { page: 'recipe', recipe: r, servings: 4 }, [
      { role: 'user', content: 'Is it spicy?' },
      { role: 'assistant', content: 'Not at all.' },
    ]);
    expect(out.answer).toBe('Add sliced mushrooms at step 2.\n\nCook 5 minutes more.');
    const body = mock.requests.at(-1)!.body as { messages: Array<{ role: string; content: string }>; options: { num_ctx: number } };
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    const last = body.messages.at(-1)!.content;
    expect(last).toContain('Recipe: Garlic Pasta');
    expect(last).toContain('2. Fry garlic in oil.');
    expect(last).toContain('scaled to 4 servings');
    expect(last).toContain('Kids like it mild.');
    expect(last).toContain('Question: How do I add mushrooms?');
    expect(body.options.num_ctx).toBe(8192);
  });

  it('refuses an empty question and discards empty answers', async () => {
    expect(await code(askAssistant(client(), '   ', { page: 'Pantry' }))).toBe('invalid-config');
    mock.reply({ answer: '' });
    expect(await code(askAssistant(client(), 'Hi?', { page: 'Pantry' }))).toBe('invalid-output');
  });
});

describe('health check', () => {
  const r = () =>
    recipe({
      title: 'Creamy Spinach Pasta',
      ingredients: [ing(200, 'g', 'spaghetti'), ing(150, 'g', 'spinach'), ing(100, 'ml', 'heavy cream'), ing(1, 'pinch', 'salt')],
      steps: ['Boil pasta.', 'Wilt spinach in the cream.'],
      nutrition: { calories: 620, protein: 18, carbs: null, fat: 30, basis: 'user-entered' },
    });

  it('rates each numbered ingredient and summarizes, keeping recipe order', async () => {
    mock.reply({
      ingredients: [
        { n: 2, rating: 'great', reason: 'Leafy greens add fibre and iron.' },
        { n: 1, rating: 'Okay', reason: 'Refined pasta; wholewheat adds fibre.' },
        { n: 3, rating: 'limit', reason: 'Lots of saturated fat.' },
        { n: 3, rating: 'good', reason: 'Duplicate, ignored.' },
        { n: 9, rating: 'great', reason: 'Not in the recipe.' },
        { n: 4, rating: 'excellent', reason: 'Not a known rating.' },
      ],
      score: '5.6',
      verdict: 'A rich treat with some greens',
      summary: 'Good greens, but the cream makes it heavy.',
      tips: ['Use half milk, half cream.', '', 'Add peas.', 'Use wholewheat pasta.', 'Fourth tip dropped.'],
    });
    const out = await reviewRecipeHealth(client(), r());
    expect(out.ingredients).toEqual([
      { index: 0, name: 'spaghetti', rating: 'okay', reason: 'Refined pasta; wholewheat adds fibre.' },
      { index: 1, name: 'spinach', rating: 'great', reason: 'Leafy greens add fibre and iron.' },
      { index: 2, name: 'heavy cream', rating: 'limit', reason: 'Lots of saturated fat.' },
    ]);
    expect(out.unrated).toEqual([3]);
    expect(out.score).toBe(6);
    expect(out.verdict).toBe('A rich treat with some greens');
    expect(out.tips).toEqual(['Use half milk, half cream.', 'Add peas.', 'Use wholewheat pasta.']);

    const body = mock.requests.at(-1)!.body as { messages: Array<{ content: string }>; options: { num_ctx: number } };
    const prompt = body.messages[1].content;
    expect(prompt).toContain('1. 200 g spaghetti');
    expect(prompt).toContain('4. 1 pinch salt');
    expect(prompt).toContain('2. Wilt spinach in the cream.');
    expect(prompt).toContain('620 kcal, 18 g protein, 30 g fat');
    expect(body.messages[0].content).toContain('no medical');
    expect(body.options.num_ctx).toBe(8192);
  });

  it('shortens long reasons instead of throwing the answer away', async () => {
    mock.reply({ ingredients: [{ n: 1, rating: 'good', reason: 'x'.repeat(500) }], score: 7, verdict: 'Fine', summary: 'Fine.', tips: [] });
    const out = await reviewRecipeHealth(client(), r());
    expect(out.ingredients[0].reason).toHaveLength(240);
    expect(out.unrated).toEqual([1, 2, 3]);
  });

  it('discards answers with no usable ratings or a bad score', async () => {
    mock.reply({ ingredients: [{ n: 7, rating: 'good', reason: 'Wrong number.' }], score: 7, verdict: 'Fine', summary: 'Fine.', tips: [] });
    expect(await code(reviewRecipeHealth(client(), r()))).toBe('invalid-output');
    mock.reply({ ingredients: [{ n: 1, rating: 'good', reason: 'Ok.' }], score: 42, verdict: 'Fine', summary: 'Fine.', tips: [] });
    expect(await code(reviewRecipeHealth(client(), r()))).toBe('invalid-output');
    mock.reply({ ingredients: [{ n: 1, rating: 'good', reason: 'Ok.' }], score: 7, verdict: '', summary: 'Fine.', tips: [] });
    expect(await code(reviewRecipeHealth(client(), r()))).toBe('invalid-output');
  });

  it('refuses a recipe with no ingredients without asking the model', async () => {
    const before = mock.requests.length;
    expect(await code(reviewRecipeHealth(client(), recipe({ ingredients: [] })))).toBe('invalid-config');
    expect(mock.requests.length).toBe(before);
  });
});

import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/server/app';
import { SEED_RECIPES } from '../src/server/seed';
import { makeTempDir, recipeInput } from './helpers';
import { startMockOllama, type MockOllama } from './mock-ollama';

let tmp: ReturnType<typeof makeTempDir>;
let app: App;
let base: string;
let mock: MockOllama;

beforeAll(async () => {
  mock = await startMockOllama();
});
afterAll(() => mock.close());

beforeEach(async () => {
  tmp = makeTempDir();
  app = createApp({ dataDir: tmp.dir, aiTimeoutMs: 2000 });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await app.close();
  tmp.cleanup();
});

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json: json as Record<string, unknown> & Array<Record<string, unknown>>, headers: res.headers };
}

describe('HTTP API', () => {
  it('serves seeded recipes on first run', async () => {
    const r = await call('GET', '/api/recipes');
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(SEED_RECIPES.length);
  });

  it('supports recipe CRUD and favorites', async () => {
    const created = await call('POST', '/api/recipes', recipeInput());
    expect(created.status).toBe(200);
    const id = created.json.id as string;
    expect((await call('POST', `/api/recipes/${id}/favorite`, { favorite: true })).json.favorite).toBe(true);
    expect((await call('GET', `/api/recipes/${id}`)).json.favorite).toBe(true);
    expect((await call('PUT', `/api/recipes/${id}`, recipeInput({ title: 'Renamed' }))).json.title).toBe('Renamed');
    expect((await call('POST', `/api/recipes/${id}/duplicate`)).json.title).toBe('Renamed (copy)');
    expect((await call('DELETE', `/api/recipes/${id}?confirm=true`)).status).toBe(200);
    expect((await call('GET', `/api/recipes/${id}`)).status).toBe(404);
  });

  it('returns validation details for bad input', async () => {
    const r = await call('POST', '/api/recipes', { ...recipeInput(), title: '' });
    expect(r.status).toBe(400);
    expect(r.json.details).toEqual(expect.arrayContaining([expect.stringMatching(/Title is required/)]));
  });

  it('requires explicit confirmation for destructive actions', async () => {
    const id = SEED_RECIPES[0].id;
    const del = await call('DELETE', `/api/recipes/${id}`);
    expect(del.status).toBe(428);
    expect(del.json.code).toBe('confirmation-required');
    expect((await call('GET', `/api/recipes/${id}`)).status).toBe(200);

    await call('POST', '/api/shopping', { name: 'Milk', quantity: 1, unit: 'l', category: '' });
    const [milk] = (await call('GET', '/api/shopping')).json;
    await call('PUT', `/api/shopping/${milk.id}`, { name: 'Milk', quantity: 1, unit: 'l', category: '', checked: true });
    expect((await call('POST', '/api/shopping/clear-checked', {})).status).toBe(428);
    expect((await call('GET', '/api/shopping')).json).toHaveLength(1);
    expect((await call('POST', '/api/shopping/clear-checked', { confirm: true })).json.removed).toBe(1);

    const backup = (await call('GET', '/api/backup/export')).json;
    expect((await call('POST', '/api/backup/import', { backup, strategy: 'replace' })).status).toBe(428);
  });

  it('refuses requests for other hostnames and non-JSON bodies', async () => {
    // fetch() can't override Host, so use node:http directly (simulates DNS rebinding).
    const evilStatus = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/api/recipes`, { headers: { host: 'attacker.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(evilStatus).toBe(403);
    const form = await fetch(base + '/api/recipes', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(recipeInput()) });
    expect(form.status).toBe(415);
  });

  it('plans meals, handles repeats and builds the shopping list', async () => {
    const id = SEED_RECIPES[1].id;
    const meal = { date: '2026-10-13', slot: 'dinner', recipeId: id, servings: 4, note: '' };
    expect((await call('POST', '/api/meals', meal)).status).toBe(200);
    const repeat = await call('POST', '/api/meals', { ...meal, date: '2026-10-14' });
    expect(repeat.status).toBe(409);
    expect(repeat.json.code).toBe('repeat');
    expect((await call('POST', '/api/meals', { ...meal, date: '2026-10-14', allowRepeat: true })).status).toBe(200);
    expect((await call('GET', '/api/meals?from=2026-10-12&to=2026-10-18')).json).toHaveLength(2);
    expect((await call('GET', '/api/meals?from=bad&to=2026-10-18')).status).toBe(400);

    const added = await call('POST', '/api/shopping/from-meals', { from: '2026-10-12', to: '2026-10-18', skipStaples: true });
    expect(added.json).toMatchObject({ meals: 2 });
    const list = (await call('GET', '/api/shopping')).json;
    const pasta = list.find((i) => i.name === 'pasta');
    expect(pasta).toMatchObject({ quantity: null, unit: '' }); // ingredients only, no amounts
    expect(list.filter((i) => i.name === 'pasta')).toHaveLength(1);
    expect(list.some((i) => i.name === 'salt')).toBe(false);
  });

  it('exports and validates backups', async () => {
    const exp = await call('GET', '/api/backup/export');
    expect(exp.headers.get('content-disposition')).toMatch(/attachment; filename="cookbook-backup-/);
    expect(exp.json.format).toBe('the-cookbook-backup');

    expect((await call('POST', '/api/backup/preview', { hello: 'world' })).json.error).toMatch(/not a Cookbook backup/);
    expect((await call('POST', '/api/backup/preview', { ...exp.json, version: 99 })).json.error).toMatch(/newer version/);
    const damaged = await call('POST', '/api/backup/preview', { ...exp.json, data: { recipes: [{ id: 'x' }] } });
    expect(damaged.status).toBe(400);
    expect(damaged.json.error).toMatch(/damaged or incomplete/);
    expect((damaged.json.details as string[]).length).toBeGreaterThan(0);

    const preview = await call('POST', '/api/backup/preview', exp.json);
    expect(preview.status).toBe(200);
  });

  it('accepts real images only and serves them back', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const up = await fetch(base + '/api/images', { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
    const { imagePath } = (await up.json()) as { imagePath: string };
    expect(imagePath).toMatch(/^uploads\/[a-f0-9]{32}\.png$/);
    const got = await fetch(`${base}/api/images/${imagePath}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');

    const fake = await fetch(base + '/api/images', { method: 'POST', headers: { 'content-type': 'image/png' }, body: '<svg onload=alert(1)>' });
    expect(fake.status).toBe(415);
    expect((await fetch(`${base}/api/images/uploads/..%2F..%2Fcookbook.db`)).status).toBe(404);
  });
});

describe('optional AI through the API', () => {
  it('is disabled by default and works without it', async () => {
    expect((await call('GET', '/api/settings/ai')).json).toMatchObject({ enabled: false, baseUrl: 'http://127.0.0.1:11434' });
    const r = await call('POST', '/api/ai/substitutions', { recipeId: SEED_RECIPES[0].id, ingredientIndex: 0 });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('ai-disabled');
    expect(mock.requests).toHaveLength(0);
  });

  it('uses COOKBOOK_OLLAMA_URL as the default address (still disabled)', async () => {
    process.env.COOKBOOK_OLLAMA_URL = 'http://127.0.0.1:11435';
    try {
      expect((await call('GET', '/api/settings/ai')).json).toMatchObject({ enabled: false, baseUrl: 'http://127.0.0.1:11435' });
    } finally {
      delete process.env.COOKBOOK_OLLAMA_URL;
    }
  });

  it('refuses a non-local Ollama address', async () => {
    await call('PUT', '/api/settings/ai', { enabled: true, baseUrl: 'https://cloud.example.com', model: 'x' });
    const r = await call('POST', '/api/ai/status');
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('ai-invalid-config');
  });

  it('never writes to the database: drafts and suggestions are previews only', async () => {
    await call('PUT', '/api/settings/ai', { enabled: true, baseUrl: mock.url, model: 'llama3.1:8b' });
    const before = JSON.stringify((await call('GET', '/api/backup/export')).json.data);

    mock.reply({ substitutions: [{ substitute: 'tofu', amount: '300 g', note: 'Press first.' }] });
    const subs = await call('POST', '/api/ai/substitutions', { recipeId: SEED_RECIPES[0].id, ingredientIndex: 1 });
    expect(subs.status).toBe(200);

    mock.reply({
      title: 'Draft Soup',
      description: '',
      servings: 2,
      prepMinutes: 5,
      cookMinutes: 20,
      difficulty: 'easy',
      ingredients: [{ quantity: 1, unit: 'l', name: 'stock', note: '' }],
      steps: ['Simmer.'],
      tags: [],
    });
    const draft = await call('POST', '/api/ai/draft', { request: 'a simple soup' });
    expect(draft.status).toBe(200);
    expect((draft.json.draft as { title: string }).title).toBe('Draft Soup');

    const after = JSON.stringify((await call('GET', '/api/backup/export')).json.data);
    expect(after).toBe(before);
  });

  it('recommends seeded recipes through the API without writing anything', async () => {
    await call('PUT', '/api/settings/ai', { enabled: true, baseUrl: mock.url, model: 'llama3.1:8b' });
    const before = JSON.stringify((await call('GET', '/api/backup/export')).json.data);
    mock.reply({ picks: [{ id: 'R1', reason: 'Fits.' }], note: '' });
    const r = await call('POST', '/api/ai/recommend', { request: 'quick dinner' });
    expect(r.status).toBe(200);
    const recs = r.json.recommendations as Array<{ recipeId: string }>;
    expect(recs).toHaveLength(1);
    expect(SEED_RECIPES.some((s) => s.id === recs[0].recipeId)).toBe(true);
    expect(JSON.stringify((await call('GET', '/api/backup/export')).json.data)).toBe(before);
  });

  it('daily message: built-in tip when AI is off, Llama once per day when on', async () => {
    const off = await call('GET', '/api/daily-message');
    expect(off.json).toMatchObject({ source: 'tip' });
    expect(typeof off.json.text).toBe('string');
    const before = mock.requests.length;
    expect(mock.requests.length).toBe(before);

    await call('PUT', '/api/settings/ai', { enabled: true, baseUrl: mock.url, model: 'llama3.1:8b' });
    mock.reply('not json');
    const failed = await call('GET', '/api/daily-message');
    expect(failed.json).toMatchObject({ source: 'tip' });
    expect(failed.json.note).toMatch(/valid JSON/);

    mock.reply({ message: 'Good morning! Soup weather, maybe?' });
    const first = await call('GET', '/api/daily-message');
    expect(first.json).toMatchObject({ source: 'llama', text: 'Good morning! Soup weather, maybe?' });
    const calls = mock.requests.length;
    mock.reply({ message: 'A different message' });
    const again = await call('GET', '/api/daily-message');
    expect(again.json.text).toBe('Good morning! Soup weather, maybe?'); // cached for the day
    expect(mock.requests.length).toBe(calls);
  });

  it('manages stores and needs confirmation to remove one', async () => {
    const created = await call('POST', '/api/stores', { name: 'Costco' });
    expect(created.status).toBe(200);
    expect((await call('POST', '/api/stores', { name: 'costco' })).status).toBe(409);
    expect((await call('PUT', `/api/stores/${created.json.id}`, { name: 'Costco Wholesale' })).json.name).toBe('Costco Wholesale');
    expect((await call('DELETE', `/api/stores/${created.json.id}`)).status).toBe(428);
    expect((await call('DELETE', `/api/stores/${created.json.id}?confirm=true`)).json).toEqual({ itemsMoved: 0 });
    expect((await call('GET', '/api/stores')).json).toEqual([]);
  });

  it('surfaces malformed model output as a clear error', async () => {
    await call('PUT', '/api/settings/ai', { enabled: true, baseUrl: mock.url, model: 'llama3.1:8b' });
    mock.reply('not json at all');
    const r = await call('POST', '/api/ai/draft', { request: 'soup' });
    expect(r.status).toBe(502);
    expect(r.json.code).toBe('ai-invalid-output');
  });
});

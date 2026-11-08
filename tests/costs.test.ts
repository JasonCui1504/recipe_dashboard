import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/server/app';
import { costsSiteUrl } from '../src/server/costs';
import { makeTempDir } from './helpers';

type Sent = { url: string; init: RequestInit };

let tmp: ReturnType<typeof makeTempDir>;
let app: App;
let base: string;
let sent: Sent[];
let reply: () => Response;

beforeEach(async () => {
  tmp = makeTempDir();
  sent = [];
  reply = () => Response.json({ ok: true });
  app = createApp({
    dataDir: tmp.dir,
    costsAutoDelayMs: 20,
    costsFetch: async (url, init) => {
      sent.push({ url, init: init ?? {} });
      return reply();
    },
  });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await app.close();
  tmp.cleanup();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('send to Costs', () => {
  it('needs a token before sending, and never sends without one', async () => {
    const r = await call('POST', '/api/costs/send');
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('costs-not-configured');
    expect(sent).toHaveLength(0);
  });

  it('keeps the token on this computer and never returns it', async () => {
    const saved = await call('PUT', '/api/settings/costs', { url: 'https://www.example.com', auto: false, token: 'secret-token-1234567' });
    expect(saved.json).toMatchObject({ url: 'https://www.example.com', auto: false, tokenSet: true });
    expect(JSON.stringify(saved.json)).not.toContain('secret-token');
    // Saving without a token keeps it.
    const again = await call('PUT', '/api/settings/costs', { url: 'https://www.example.com', auto: false });
    expect(again.json.tokenSet).toBe(true);
    const get = await call('GET', '/api/settings/costs');
    expect(JSON.stringify(get.json)).not.toContain('secret-token');
  });

  it('sends the whole list with store names and the bearer token', async () => {
    const store = (await call('POST', '/api/stores', { name: 'Trader Joe’s' })).json as { id: string };
    await call('POST', '/api/shopping', { name: 'lemons', quantity: 3, unit: '', category: '', store: store.id });
    await call('POST', '/api/shopping', { name: 'milk', quantity: null, unit: '', category: '', store: '' });
    await call('PUT', '/api/settings/costs', { url: 'https://www.example.com/', auto: false, token: 'secret-token-1234567' });

    const r = await call('POST', '/api/costs/send');
    expect(r.status).toBe(200);
    expect(r.json.count).toBe(2);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://www.example.com/api/costs/import');
    expect(sent[0].init.redirect).toBe('manual');
    expect((sent[0].init.headers as Record<string, string>).authorization).toBe('Bearer secret-token-1234567');
    const body = JSON.parse(String(sent[0].init.body)) as { items: Array<Record<string, unknown>> };
    expect(body.items).toEqual([
      expect.objectContaining({ name: 'lemons', quantity: 3, store: 'Trader Joe’s', checked: false }),
      expect.objectContaining({ id: expect.any(String), name: 'milk', quantity: null, store: '', checked: false }),
    ]);
    const status = await call('GET', '/api/settings/costs');
    expect(status.json.last).toMatchObject({ ok: true, count: 2 });
  });

  it('explains a rejected token and a redirect instead of following it', async () => {
    await call('PUT', '/api/settings/costs', { url: 'https://example.com', auto: false, token: 'secret-token-1234567' });
    reply = () => new Response(null, { status: 401 });
    expect((await call('POST', '/api/costs/send')).json.error).toMatch(/didn’t accept the sync token/);
    reply = () => new Response(null, { status: 307, headers: { location: 'https://www.example.com/api/costs/import' } });
    expect((await call('POST', '/api/costs/send')).json.error).toMatch(/redirected to https:\/\/www\.example\.com/);
    expect(sent).toHaveLength(2);
    const status = await call('GET', '/api/settings/costs');
    expect(status.json.last).toMatchObject({ ok: false });
  });

  it('sends by itself shortly after the list changes when automatic sending is on', async () => {
    await call('PUT', '/api/settings/costs', { url: 'https://www.example.com', auto: true, token: 'secret-token-1234567' });
    await wait(60);
    sent = [];
    await call('POST', '/api/shopping', { name: 'eggs', quantity: null, unit: '', category: '', store: '' });
    await call('POST', '/api/shopping', { name: 'bread', quantity: null, unit: '', category: '', store: '' });
    expect(sent).toHaveLength(0); // waits for the changes to settle
    await wait(80);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0].init.body)).items).toHaveLength(2);
    // Reading the list doesn't send.
    await call('GET', '/api/shopping');
    await wait(60);
    expect(sent).toHaveLength(1);
  });

  it('does not send by itself when automatic sending is off', async () => {
    await call('PUT', '/api/settings/costs', { url: 'https://www.example.com', auto: false, token: 'secret-token-1234567' });
    await call('POST', '/api/shopping', { name: 'eggs', quantity: null, unit: '', category: '', store: '' });
    await wait(60);
    expect(sent).toHaveLength(0);
  });
});

describe('costsSiteUrl', () => {
  it('accepts https and http on this computer only', () => {
    expect(costsSiteUrl('https://www.jascui.com').origin).toBe('https://www.jascui.com');
    expect(costsSiteUrl('http://127.0.0.1:3000').origin).toBe('http://127.0.0.1:3000');
    expect(() => costsSiteUrl('http://www.jascui.com')).toThrow(/https/);
    expect(() => costsSiteUrl('https://user:pw@www.jascui.com')).toThrow(/username/);
    expect(() => costsSiteUrl('not a url')).toThrow();
  });
});

describe('ticks from Costs', () => {
  type Item = { id: string; name: string; checked: boolean };
  let remote: Array<{ id: string; checked: boolean }>;

  beforeEach(async () => {
    remote = [];
    reply = () => Response.json({ sentAt: '2026-11-08T00:00:00Z', items: remote });
    await call('PUT', '/api/settings/costs', { url: 'https://www.example.com', auto: false, token: 'secret-token-1234567' });
  });

  const add = async (name: string): Promise<Item> => {
    await call('POST', '/api/shopping', { name, quantity: null, unit: '', category: '', store: '' });
    const items = (await call('GET', '/api/shopping')).json as unknown as Item[];
    return items.find((i) => i.name === name)!;
  };
  const shopping = async () => (await call('GET', '/api/shopping')).json as unknown as Item[];
  const pantry = async () => (await call('GET', '/api/pantry')).json as unknown as Array<{ id: string; name: string; usedUp: boolean }>;

  it('checks off what was ticked on Costs and adds it to the pantry', async () => {
    const lemons = await add('lemons');
    const milk = await add('milk');
    remote = [
      { id: lemons.id, checked: true },
      { id: milk.id, checked: false },
      { id: 'gone-from-the-list', checked: true },
    ];
    const r = await call('POST', '/api/costs/pull', { toPantry: true });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ checked: ['lemons'], unchecked: [] });
    expect(sent.at(-1)?.init.method).toBe('GET');
    expect((sent.at(-1)?.init.headers as Record<string, string>).authorization).toBe('Bearer secret-token-1234567');
    const items = await shopping();
    expect(items.find((i) => i.id === lemons.id)?.checked).toBe(true);
    expect(items.find((i) => i.id === milk.id)?.checked).toBe(false);
    expect((await pantry()).map((p) => p.name)).toContain('lemons');
    // Pulling again changes nothing.
    expect((await call('POST', '/api/costs/pull', { toPantry: true })).json).toEqual({ checked: [], unchecked: [] });
    expect((await pantry()).filter((p) => p.name === 'lemons')).toHaveLength(1);
  });

  it('unticking on Costs undoes only what a tick from Costs did', async () => {
    const lemons = await add('lemons');
    const eggs = await add('eggs');
    // Eggs were checked off at home, by hand.
    await call('PUT', `/api/shopping/${eggs.id}`, { name: 'eggs', quantity: null, unit: '', category: '', checked: true, store: '' });
    remote = [{ id: lemons.id, checked: true }];
    await call('POST', '/api/costs/pull', { toPantry: true });

    remote = [
      { id: lemons.id, checked: false },
      { id: eggs.id, checked: false },
    ];
    const r = await call('POST', '/api/costs/pull', { toPantry: true });
    expect(r.json).toEqual({ checked: [], unchecked: ['lemons'] });
    const items = await shopping();
    expect(items.find((i) => i.id === lemons.id)?.checked).toBe(false);
    expect(items.find((i) => i.id === eggs.id)?.checked).toBe(true);
    expect((await pantry()).map((p) => p.name)).not.toContain('lemons');
  });

  it('restocks a finished pantry item, and puts it back on Finished when unticked', async () => {
    const created = (await call('POST', '/api/pantry', { name: 'Milk', quantity: null, unit: '', category: 'Dairy', expiresOn: null, notes: '', usedUp: true }))
      .json as { id: string };
    const milk = await add('milk');
    remote = [{ id: milk.id, checked: true }];
    await call('POST', '/api/costs/pull', { toPantry: true });
    expect((await pantry()).find((p) => p.id === created.id)?.usedUp).toBe(false);
    remote = [{ id: milk.id, checked: false }];
    await call('POST', '/api/costs/pull', { toPantry: true });
    expect((await pantry()).find((p) => p.id === created.id)?.usedUp).toBe(true);
  });

  it('leaves the pantry alone when that option is off', async () => {
    const lemons = await add('lemons');
    remote = [{ id: lemons.id, checked: true }];
    await call('POST', '/api/costs/pull', { toPantry: false });
    expect((await shopping())[0].checked).toBe(true);
    expect(await pantry()).toHaveLength(0);
  });

  it('reports being offline without changing anything', async () => {
    await add('lemons');
    reply = () => {
      throw new TypeError('fetch failed');
    };
    const r = await call('POST', '/api/costs/pull', { toPantry: true });
    expect(r.status).toBe(502);
    expect(r.json.code).toBe('costs-offline');
    expect((await shopping())[0].checked).toBe(false);
  });
});

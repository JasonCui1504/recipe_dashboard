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
    const milk = (await call('POST', '/api/shopping', { name: 'milk', quantity: null, unit: '', category: '', store: '' })).json as {
      item: { id: string };
    };
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
      expect.objectContaining({ id: milk.item?.id ?? expect.any(String), name: 'milk', quantity: null, store: '', checked: false }),
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

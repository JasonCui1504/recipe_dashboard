import type { CostsSync, ShoppingItem, Store } from '../shared/schema';
import type { FetchLike } from './ai';
import { AppError } from './errors';

/**
 * Sends the shopping list to the Costs page on the website (jascui.com/costs),
 * where it shows up as a checklist you can tick off in the store, and reads
 * back which items were ticked there. These are the only requests this app
 * makes off the computer, and only once a sync token is saved in Settings.
 * Without the internet everything else keeps working; only these fail.
 */

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/;

/** The site's address: https, or http on this computer (for testing). */
export function costsSiteUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AppError(400, 'Enter the site address, like https://www.jascui.com.');
  }
  if (url.username || url.password) throw new AppError(400, 'The site address can’t contain a username or password.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.test(url.hostname))) {
    throw new AppError(400, 'The site address must start with https://.');
  }
  return url;
}

export interface CostsPayloadItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string;
  store: string;
  aisle: string;
  checked: boolean;
}

/** The list as the site expects it, with store names instead of ids. */
export function costsPayload(items: ShoppingItem[], stores: Store[]): { items: CostsPayloadItem[] } {
  const names = new Map(stores.map((s) => [s.id, s.name]));
  return {
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      store: names.get(i.store) ?? '',
      aisle: i.category,
      checked: i.checked,
    })),
  };
}

/** Which items were ticked off on the Costs page: [{ id, checked }]. */
export async function fetchCostsTicks(
  settings: CostsSync,
  options: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<Array<{ id: string; checked: boolean }>> {
  if (!settings.token) throw new AppError(400, 'Add your Costs sync token in Settings first.', [], 'costs-not-configured');
  const url = new URL('/api/costs/import', costsSiteUrl(settings.url));
  let res: Response;
  try {
    res = await (options.fetch ?? fetch)(url.toString(), {
      method: 'GET',
      headers: { authorization: `Bearer ${settings.token}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch {
    throw new AppError(502, `Couldn’t reach ${url.host}. Are you online?`, [], 'costs-offline');
  }
  if (res.status === 401) throw new AppError(502, 'The site didn’t accept the sync token. Check it in Settings.');
  if (!res.ok) throw new AppError(502, `The site couldn’t send the ticks (HTTP ${res.status}).`);
  const body = (await res.json().catch(() => null)) as { items?: unknown } | null;
  const items = Array.isArray(body?.items) ? body.items : [];
  return items
    .filter((i): i is { id: string; checked: boolean } => typeof i?.id === 'string' && typeof i?.checked === 'boolean')
    .map((i) => ({ id: i.id, checked: i.checked }));
}

export async function sendToCosts(
  settings: CostsSync,
  payload: { items: CostsPayloadItem[] },
  options: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<{ count: number }> {
  if (!settings.token) throw new AppError(400, 'Add your Costs sync token in Settings first.', [], 'costs-not-configured');
  const url = new URL('/api/costs/import', costsSiteUrl(settings.url));
  const doFetch = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.token}` },
      body: JSON.stringify(payload),
      // Never follow a redirect: it would carry the token somewhere else.
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new AppError(502, timedOut ? `${url.host} took too long to answer.` : `Couldn’t reach ${url.host}. Are you online?`);
  }
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location');
    throw new AppError(502, `${url.host} redirected${to ? ` to ${new URL(to, url).origin}` : ''}. Use that address in Settings.`);
  }
  if (res.status === 401) throw new AppError(502, 'The site didn’t accept the sync token. Check it in Settings.');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new AppError(502, `The site couldn’t save the list${body?.error ? `: ${body.error}` : ` (HTTP ${res.status})`}.`);
  }
  return { count: payload.items.length };
}

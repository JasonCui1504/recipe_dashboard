import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { backupSchema, checkBackupHeader, CONFLICT_STRATEGIES, type Backup } from '../shared/backup';
import { isValidIsoDate } from '../shared/dates';
import { describeZodError } from '../shared/schema';
import { AiError, draftRecipe, OllamaClient, suggestSubstitutions, type FetchLike } from './ai';
import { openDatabase } from './db';
import { AppError } from './errors';
import { MAX_IMAGE_BYTES, resolveImage, saveImage } from './images';
import { Store } from './store';

export interface AppOptions {
  /** Directory for the database and uploaded images. */
  dataDir: string;
  /** Built client files to serve (production). Omit in development (Vite serves them). */
  staticDir?: string;
  /** Injected fetch for the Ollama client (tests use a mock). */
  aiFetch?: FetchLike;
  aiTimeoutMs?: number;
}

export interface App {
  server: Server;
  store: Store;
  db: DatabaseSync;
  close(): Promise<void>;
}

type Params = Record<string, string>;
interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Params;
  query: URLSearchParams;
  body: () => Promise<unknown>;
}
type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

const MAX_JSON_BYTES = 15 * 1024 * 1024;
const ALLOWED_HOSTS = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new AppError(413, 'The request is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Everything the page loads comes from this server; the browser blocks anything else. */
const CSP =
  "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

export function createApp(options: AppOptions): App {
  const db = openDatabase(join(options.dataDir, 'cookbook.db'));
  const store = new Store(db);
  store.seedOnFirstRun();

  const routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: Handler }> = [];
  const route = (method: string, path: string, handler: Handler) => {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/:(\w+)/g, (_, k: string) => {
        keys.push(k);
        return '([^/]+)';
      })}$`,
    );
    routes.push({ method, pattern, keys, handler });
  };

  const requireConfirm = (value: unknown, what: string) => {
    if (value !== true && value !== 'true') {
      throw new AppError(428, `Please confirm before ${what}.`, [], 'confirmation-required');
    }
  };
  const aiClient = () => new OllamaClient(store.getAiSettings(), { fetch: options.aiFetch, timeoutMs: options.aiTimeoutMs });
  const parseBackup = (raw: unknown): Backup => {
    const headerError = checkBackupHeader(raw);
    if (headerError) throw new AppError(400, headerError, [], 'invalid-backup');
    const parsed = backupSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, 'The backup file is damaged or incomplete.', describeZodError(parsed.error), 'invalid-backup');
    }
    return parsed.data;
  };
  const obj = (v: unknown) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
  const dateParam = (q: URLSearchParams, key: string) => {
    const v = q.get(key) ?? '';
    if (!isValidIsoDate(v)) throw new AppError(400, `"${key}" must be a YYYY-MM-DD date.`);
    return v;
  };

  route('GET', '/api/health', () => ({ ok: true }));

  // Recipes
  route('GET', '/api/recipes', () => store.listRecipes());
  route('POST', '/api/recipes', async ({ body }) => store.createRecipe(await body()));
  route('POST', '/api/recipes/restore-starters', () => ({ added: store.restoreStarterRecipes() }));
  route('GET', '/api/recipes/:id', ({ params }) => store.getRecipe(params.id));
  route('PUT', '/api/recipes/:id', async ({ params, body }) => store.updateRecipe(params.id, await body()));
  route('DELETE', '/api/recipes/:id', ({ params, query }) => {
    requireConfirm(query.get('confirm'), 'deleting a recipe');
    return store.deleteRecipe(params.id);
  });
  route('POST', '/api/recipes/:id/favorite', async ({ params, body }) => {
    const fav = z.object({ favorite: z.boolean() }).safeParse(await body());
    if (!fav.success) throw new AppError(400, '"favorite" must be true or false.');
    return store.setFavorite(params.id, fav.data.favorite);
  });
  route('POST', '/api/recipes/:id/duplicate', ({ params }) => store.duplicateRecipe(params.id));

  // Pantry
  route('GET', '/api/pantry', () => store.listPantry());
  route('POST', '/api/pantry', async ({ body }) => store.createPantryItem(await body()));
  route('PUT', '/api/pantry/:id', async ({ params, body }) => store.updatePantryItem(params.id, await body()));
  route('DELETE', '/api/pantry/:id', ({ params }) => {
    store.deletePantryItem(params.id);
    return { ok: true };
  });

  // Meal plan
  route('GET', '/api/meals', ({ query }) => store.listMeals(dateParam(query, 'from'), dateParam(query, 'to')));
  route('POST', '/api/meals', async ({ body }) => {
    const b = obj(await body());
    const { allowRepeat, ...meal } = b;
    return store.addMeal(meal, allowRepeat === true);
  });
  route('PATCH', '/api/meals/:id', async ({ params, body }) => store.updateMealServings(params.id, obj(await body()).servings));
  route('DELETE', '/api/meals/:id', ({ params }) => {
    store.deleteMeal(params.id);
    return { ok: true };
  });

  // Shopping list
  route('GET', '/api/shopping', () => store.listShopping());
  route('POST', '/api/shopping', async ({ body }) => store.addManualShopping(await body()));
  route('POST', '/api/shopping/from-recipe', async ({ body }) => {
    const b = z
      .object({
        recipeId: z.string().min(1),
        servings: z.number().int().min(1).max(100).optional(),
        skipStaples: z.boolean().optional(),
        only: z.array(z.number().int().min(0)).max(100).optional(),
      })
      .safeParse(await body());
    if (!b.success) throw new AppError(400, 'Please choose a recipe and a valid serving count.');
    return store.addRecipeToShopping(b.data.recipeId, b.data.servings, b.data.skipStaples, b.data.only);
  });
  route('POST', '/api/shopping/from-meals', async ({ body }) => {
    const b = obj(await body());
    const q = new URLSearchParams({ from: String(b.from ?? ''), to: String(b.to ?? '') });
    const only = z.array(z.string().max(120)).max(500).optional().safeParse(b.only);
    if (!only.success) throw new AppError(400, '"only" must be a list of ingredient names.');
    return store.addMealsToShopping(dateParam(q, 'from'), dateParam(q, 'to'), b.skipStaples === true, only.data);
  });
  route('POST', '/api/shopping/clear-checked', async ({ body }) => {
    requireConfirm(obj(await body()).confirm, 'clearing completed items');
    return { removed: store.clearCheckedShopping() };
  });
  route('PUT', '/api/shopping/:id', async ({ params, body }) => store.updateShoppingItem(params.id, await body()));
  route('DELETE', '/api/shopping/:id', ({ params }) => {
    store.deleteShoppingItem(params.id);
    return { ok: true };
  });

  // Backup
  route('GET', '/api/backup/export', ({ res }) => {
    const backup = store.exportAll();
    const name = `cookbook-backup-${backup.exportedAt.slice(0, 10)}.json`;
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(backup, null, 2));
    return undefined;
  });
  route('POST', '/api/backup/preview', async ({ body }) => store.previewImport(parseBackup(await body())));
  route('POST', '/api/backup/import', async ({ body }) => {
    const b = obj(await body());
    const strategy = z.enum(CONFLICT_STRATEGIES).safeParse(b.strategy ?? 'skip');
    if (!strategy.success) throw new AppError(400, 'Unknown conflict strategy.');
    const backup = parseBackup(b.backup);
    requireConfirm(b.confirm, 'importing a backup');
    return store.importBackup(backup, strategy.data);
  });

  // Images
  route('POST', '/api/images', async ({ req }) => {
    if (!String(req.headers['content-type'] ?? '').startsWith('image/')) {
      throw new AppError(415, 'Upload an image file.');
    }
    const bytes = await readBody(req, MAX_IMAGE_BYTES + 1);
    return { imagePath: saveImage(options.dataDir, bytes) };
  });
  route('GET', '/api/images/uploads/:file', ({ params, res }) => {
    const img = resolveImage(options.dataDir, `uploads/${params.file}`);
    if (!img || !existsSync(img.file)) throw new AppError(404, 'Image not found.');
    res.writeHead(200, { 'content-type': img.mime, 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    createReadStream(img.file).pipe(res);
    return undefined;
  });

  // Settings + optional AI
  route('GET', '/api/settings/ai', () => store.getAiSettings());
  route('PUT', '/api/settings/ai', async ({ body }) => store.setAiSettings(await body()));
  route('POST', '/api/ai/status', () => aiClient().status());
  route('POST', '/api/ai/substitutions', async ({ body }) => {
    const b = z.object({ recipeId: z.string(), ingredientIndex: z.number().int().min(0) }).safeParse(await body());
    if (!b.success) throw new AppError(400, 'Choose an ingredient.');
    const client = aiClient();
    return suggestSubstitutions(client, store.getRecipe(b.data.recipeId), b.data.ingredientIndex);
  });
  route('POST', '/api/ai/draft', async ({ body }) => {
    const b = z.object({ request: z.string().max(400) }).safeParse(await body());
    if (!b.success) throw new AppError(400, 'Describe the recipe in 400 characters or fewer.');
    return { draft: await draftRecipe(aiClient(), b.data.request) };
  });

  const staticRoot = options.staticDir ? resolve(options.staticDir) : null;
  const serveStatic = (urlPath: string, res: ServerResponse): boolean => {
    if (!staticRoot) return false;
    let rel: string;
    try {
      rel = decodeURIComponent(urlPath);
    } catch {
      return false;
    }
    let file = resolve(staticRoot, `.${rel}`);
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) return false;
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (extname(rel)) return false; // missing asset → 404
      file = join(staticRoot, 'index.html'); // client-side route
    }
    const headers: Record<string, string> = {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    };
    if (file.endsWith('.html')) {
      headers['content-security-policy'] = CSP;
      headers['cache-control'] = 'no-cache';
    } else if (rel.startsWith('/assets/')) {
      headers['cache-control'] = 'public, max-age=31536000, immutable';
    }
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
    return true;
  };

  const server = createServer(async (req, res) => {
    try {
      // Refuse requests addressed to other hostnames (DNS-rebinding protection).
      if (!ALLOWED_HOSTS.test(req.headers.host ?? '')) {
        throw new AppError(403, 'This app only answers requests addressed to localhost.');
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const method = req.method ?? 'GET';

      if (!url.pathname.startsWith('/api/')) {
        if ((method === 'GET' || method === 'HEAD') && serveStatic(url.pathname, res)) return;
        throw new AppError(404, 'Not found.');
      }

      const match = routes
        .map((r) => ({ r, m: r.pattern.exec(url.pathname) }))
        .filter((x) => x.m !== null);
      if (match.length === 0) throw new AppError(404, 'Not found.');
      const hit = match.find((x) => x.r.method === method);
      if (!hit) throw new AppError(405, 'Method not allowed.');

      const params: Params = {};
      hit.r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(hit.m![i + 1]);
      });
      const body = async () => {
        // Only JSON bodies are accepted. This also stops other websites from
        // posting simple cross-site forms to the local API.
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
          throw new AppError(415, 'Send JSON with Content-Type: application/json.');
        }
        const buf = await readBody(req, MAX_JSON_BYTES);
        try {
          return JSON.parse(buf.toString('utf8') || 'null');
        } catch {
          throw new AppError(400, 'The request body is not valid JSON.');
        }
      };
      const result = await hit.r.handler({ req, res, params, query: url.searchParams, body });
      if (!res.headersSent) sendJson(res, 200, result ?? { ok: true });
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof AppError) {
        sendJson(res, err.status, { error: err.message, details: err.details, code: err.code });
      } else if (err instanceof AiError) {
        const status = err.code === 'disabled' ? 409 : err.code === 'invalid-config' ? 400 : 502;
        sendJson(res, status, { error: err.message, code: `ai-${err.code}`, details: [] });
      } else {
        console.error(err);
        sendJson(res, 500, { error: 'Something went wrong on the local server.', details: [] });
      }
    }
  });

  return {
    server,
    store,
    db,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => {
          db.close();
          done();
        });
        server.closeAllConnections();
      }),
  };
}

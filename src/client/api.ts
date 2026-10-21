import type { ConflictStrategy, ImportPreview, ImportResult } from '../shared/backup';
import type { AiSettings, Meal, PantryInput, PantryItem, Recipe, RecipeInput, ShoppingInput, ShoppingItem, Store } from '../shared/schema';

/** Thin client for the local API. Every request goes to this same origin. */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details: string[] = [],
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Could not reach the local Cookbook server. Is it still running?', 0);
  }
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: undefined })
    | { error: string; details?: string[]; code?: string }
    | null;
  if (!res.ok) {
    const err = data && 'error' in data && data.error ? data : null;
    throw new ApiError(err?.error ?? `Request failed (${res.status}).`, res.status, err?.details ?? [], err?.code);
  }
  return data as T;
}

export interface ShoppingAddSummary {
  added: number;
  merged: number;
  skipped: number;
  meals?: number;
}

export const api = {
  recipes: {
    list: () => request<Recipe[]>('GET', '/api/recipes'),
    get: (id: string) => request<Recipe>('GET', `/api/recipes/${encodeURIComponent(id)}`),
    create: (input: RecipeInput) => request<Recipe>('POST', '/api/recipes', input),
    update: (id: string, input: RecipeInput) => request<Recipe>('PUT', `/api/recipes/${encodeURIComponent(id)}`, input),
    remove: (id: string) => request<{ mealsRemoved: number }>('DELETE', `/api/recipes/${encodeURIComponent(id)}?confirm=true`),
    favorite: (id: string, favorite: boolean) =>
      request<Recipe>('POST', `/api/recipes/${encodeURIComponent(id)}/favorite`, { favorite }),
    duplicate: (id: string) => request<Recipe>('POST', `/api/recipes/${encodeURIComponent(id)}/duplicate`),
    restoreStarters: () => request<{ added: number }>('POST', '/api/recipes/restore-starters'),
  },
  pantry: {
    list: () => request<PantryItem[]>('GET', '/api/pantry'),
    create: (input: PantryInput) => request<PantryItem>('POST', '/api/pantry', input),
    update: (id: string, input: PantryInput) => request<PantryItem>('PUT', `/api/pantry/${encodeURIComponent(id)}`, input),
    remove: (id: string) => request<{ ok: true }>('DELETE', `/api/pantry/${encodeURIComponent(id)}`),
  },
  meals: {
    list: (from: string, to: string) => request<Meal[]>('GET', `/api/meals?from=${from}&to=${to}`),
    add: (meal: Omit<Meal, 'id' | 'createdAt'>, allowRepeat = false) => request<Meal>('POST', '/api/meals', { ...meal, allowRepeat }),
    setServings: (id: string, servings: number) => request<Meal>('PATCH', `/api/meals/${encodeURIComponent(id)}`, { servings }),
    remove: (id: string) => request<{ ok: true }>('DELETE', `/api/meals/${encodeURIComponent(id)}`),
  },
  shopping: {
    list: () => request<ShoppingItem[]>('GET', '/api/shopping'),
    /** `store: null` = where you usually buy it; '' = any store. */
    add: (item: { name: string; quantity: number | null; unit: string; category: string; store: string | null }) =>
      request<ShoppingAddSummary>('POST', '/api/shopping', item),
    fromRecipe: (recipeId: string, servings: number, skipStaples: boolean, only?: number[]) =>
      request<ShoppingAddSummary>('POST', '/api/shopping/from-recipe', { recipeId, servings, skipStaples, only }),
    fromMeals: (from: string, to: string, skipStaples: boolean, only?: string[]) =>
      request<ShoppingAddSummary>('POST', '/api/shopping/from-meals', { from, to, skipStaples, only }),
    update: (id: string, input: ShoppingInput) => request<ShoppingItem>('PUT', `/api/shopping/${encodeURIComponent(id)}`, input),
    remove: (id: string) => request<{ ok: true }>('DELETE', `/api/shopping/${encodeURIComponent(id)}`),
    clearChecked: () => request<{ removed: number }>('POST', '/api/shopping/clear-checked', { confirm: true }),
  },
  dailyMessage: () => request<{ date: string; text: string; source: 'llama' | 'tip'; note?: string }>('GET', '/api/daily-message'),
  stores: {
    list: () => request<Store[]>('GET', '/api/stores'),
    create: (name: string) => request<Store>('POST', '/api/stores', { name }),
    rename: (id: string, name: string) => request<Store>('PUT', `/api/stores/${encodeURIComponent(id)}`, { name }),
    remove: (id: string) => request<{ itemsMoved: number }>('DELETE', `/api/stores/${encodeURIComponent(id)}?confirm=true`),
  },
  backup: {
    exportUrl: '/api/backup/export',
    preview: (backup: unknown) => request<ImportPreview>('POST', '/api/backup/preview', backup),
    import: (backup: unknown, strategy: ConflictStrategy) =>
      request<ImportResult>('POST', '/api/backup/import', { backup, strategy, confirm: true }),
  },
  images: {
    upload: async (file: File): Promise<string> => {
      let res: Response;
      try {
        res = await fetch('/api/images', { method: 'POST', headers: { 'content-type': file.type || 'image/unknown' }, body: file });
      } catch {
        throw new ApiError('Could not reach the local Cookbook server.', 0);
      }
      const data = (await res.json().catch(() => ({}))) as { imagePath?: string; error?: string };
      if (!res.ok || !data.imagePath) throw new ApiError(data.error ?? 'Upload failed.', res.status);
      return data.imagePath;
    },
    url: (imagePath: string) => `/api/images/${imagePath}`,
  },
  ai: {
    settings: () => request<AiSettings>('GET', '/api/settings/ai'),
    saveSettings: (s: AiSettings) => request<AiSettings>('PUT', '/api/settings/ai', s),
    status: () => request<{ reachable: true; models: string[]; modelInstalled: boolean }>('POST', '/api/ai/status'),
    substitutions: (recipeId: string, ingredientIndex: number) =>
      request<{ substitutions: Array<{ substitute: string; amount: string; note: string }> }>('POST', '/api/ai/substitutions', {
        recipeId,
        ingredientIndex,
      }),
    recommend: (requestText: string) =>
      request<{ recommendations: Array<{ recipeId: string; reason: string }>; note: string }>('POST', '/api/ai/recommend', { request: requestText }),
    draft: (requestText: string) => request<{ draft: RecipeInput }>('POST', '/api/ai/draft', { request: requestText }),
    ask: (
      question: string,
      history: Array<{ role: 'user' | 'assistant'; content: string }>,
      page: { path: string; recipeId?: string; servings?: number },
    ) => request<{ answer: string }>('POST', '/api/ai/ask', { question, history, page }),
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

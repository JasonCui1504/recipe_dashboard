import type { Recipe } from './schema';

export type QuickFilter = 'quick' | 'vegetarian' | 'high-protein' | 'favorites';

export const QUICK_FILTERS: Array<{ id: QuickFilter; label: string; description: string }> = [
  { id: 'quick', label: 'Quick Meals', description: '30 minutes or less in total' },
  { id: 'vegetarian', label: 'Vegetarian', description: 'Labelled vegetarian or vegan' },
  { id: 'high-protein', label: 'High Protein', description: 'Tagged high-protein' },
  { id: 'favorites', label: 'Favorites', description: 'Recipes you have starred' },
];

export const QUICK_MEAL_MINUTES = 30;

export function totalMinutes(recipe: Pick<Recipe, 'prepMinutes' | 'cookMinutes'>): number {
  return recipe.prepMinutes + recipe.cookMinutes;
}

const lower = (s: string) => s.toLowerCase();

export function matchesQuickFilter(recipe: Recipe, filter: QuickFilter): boolean {
  switch (filter) {
    case 'quick':
      return totalMinutes(recipe) <= QUICK_MEAL_MINUTES;
    case 'vegetarian':
      return recipe.dietary.some((d) => ['vegetarian', 'vegan'].includes(lower(d)));
    case 'high-protein':
      return [...recipe.tags, ...recipe.dietary].some((t) => lower(t) === 'high-protein' || lower(t) === 'high protein');
    case 'favorites':
      return recipe.favorite;
  }
}

function haystack(recipe: Recipe): string {
  return lower(
    [
      recipe.title,
      recipe.description,
      recipe.cuisine,
      ...recipe.tags,
      ...recipe.dietary,
      ...recipe.ingredients.map((i) => i.name),
    ].join(' \u0000 '),
  );
}

/**
 * Every whitespace-separated term must appear somewhere in the recipe
 * (title, description, cuisine, tags, dietary labels or ingredient names).
 * Title hits rank first.
 */
export function searchRecipes(recipes: readonly Recipe[], query: string): Recipe[] {
  const terms = lower(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...recipes];
  const scored: Array<{ recipe: Recipe; score: number }> = [];
  for (const recipe of recipes) {
    const text = haystack(recipe);
    if (!terms.every((t) => text.includes(t))) continue;
    const title = lower(recipe.title);
    const score = terms.reduce((s, t) => s + (title.includes(t) ? 2 : 0), 0);
    scored.push({ recipe, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.recipe.title.localeCompare(b.recipe.title))
    .map((s) => s.recipe);
}

export interface LibraryFilters {
  query: string;
  quick: QuickFilter[];
  tag: string | null;
  difficulty: Recipe['difficulty'] | null;
  maxMinutes: number | null;
}

export type SortKey = 'title' | 'newest' | 'updated' | 'time' | 'rating';

export function filterRecipes(recipes: readonly Recipe[], filters: LibraryFilters): Recipe[] {
  return searchRecipes(recipes, filters.query).filter(
    (r) =>
      filters.quick.every((f) => matchesQuickFilter(r, f)) &&
      (!filters.tag || r.tags.some((t) => lower(t) === lower(filters.tag!))) &&
      (!filters.difficulty || r.difficulty === filters.difficulty) &&
      (filters.maxMinutes === null || totalMinutes(r) <= filters.maxMinutes),
  );
}

export function sortRecipes(recipes: readonly Recipe[], key: SortKey): Recipe[] {
  const copy = [...recipes];
  switch (key) {
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case 'newest':
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'updated':
      return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case 'time':
      return copy.sort((a, b) => totalMinutes(a) - totalMinutes(b) || a.title.localeCompare(b.title));
    case 'rating':
      return copy.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title));
  }
}

/** All distinct tags, most used first. */
export function collectTags(recipes: readonly Recipe[]): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const r of recipes) {
    for (const t of r.tags) {
      const k = lower(t);
      const entry = counts.get(k) ?? { label: t, n: 0 };
      entry.n += 1;
      counts.set(k, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).map((e) => e.label);
}

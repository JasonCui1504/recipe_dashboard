import { addDays, startOfWeek } from './dates';
import { guessCategory, normalizeIngredientName } from './ingredients';
import type { Meal, PantryItem, Recipe, ShoppingItem, Store } from './schema';
import { QUICK_MEAL_MINUTES, totalMinutes } from './search';

/**
 * Statistics for the Insights page, computed from data the app already has:
 * planned meals (the closest thing to "what you cooked"), recipes, the pantry
 * and the shopping list. Pure and deterministic, so it's easy to test.
 */

export type InsightsPeriod = '4w' | '3m' | 'all';

export const PERIODS: Array<{ id: InsightsPeriod; label: string }> = [
  { id: '4w', label: 'Last 4 weeks' },
  { id: '3m', label: 'Last 3 months' },
  { id: 'all', label: 'All time' },
];

export function periodStart(period: InsightsPeriod, today: string): string | null {
  if (period === '4w') return addDays(today, -27);
  if (period === '3m') return addDays(today, -90);
  return null;
}

export interface Ranked<T> {
  item: T;
  count: number;
}

export interface Insights {
  mealCount: number;
  distinctRecipes: number;
  mealsPerWeek: number;
  vegetarianShare: number | null;
  quickShare: number | null;
  avgMinutes: number | null;
  topRecipes: Array<Ranked<Recipe> & { lastDate: string }>;
  topIngredients: Array<Ranked<string> & { recipes: number }>;
  weekly: Array<{ weekStart: string; count: number }>;
  categories: Array<Ranked<string>>;
  difficulty: Record<Recipe['difficulty'], number>;
  veggiePacked: Array<{ recipe: Recipe; plants: number }>;
  lightest: Array<{ recipe: Recipe; calories: number }>;
  mostProtein: Array<{ recipe: Recipe; protein: number }>;
  revisit: Array<{ recipe: Recipe; lastDate: string | null }>;
  neverPlanned: number;
  pantry: { onHand: number; finished: number; expired: string[]; expiringSoon: string[] };
  shoppingByStore: Array<Ranked<string>>;
  shoppingOpen: number;
}

const LEGUMES = /\b(bean|chickpea|lentil|pea|tofu|tempeh|edamame)\b/;
const VEGGIE_LABELS = new Set(['vegetarian', 'vegan']);

/** Vegetables, fruit and legumes in a recipe (staples and herbs-only lines excluded). */
export function plantCount(recipe: Recipe): number {
  const seen = new Set<string>();
  for (const ing of recipe.ingredients) {
    if (ing.staple) continue;
    const key = normalizeIngredientName(ing.name);
    if (guessCategory(ing.name) === 'Produce' || LEGUMES.test(key)) seen.add(key);
  }
  return seen.size;
}

const isVegetarian = (r: Recipe) => r.dietary.some((d) => VEGGIE_LABELS.has(d.toLowerCase()));
const share = (n: number, of: number) => (of === 0 ? null : n / of);

export function computeInsights(input: {
  recipes: readonly Recipe[];
  meals: readonly Meal[];
  pantry: readonly PantryItem[];
  shopping: readonly ShoppingItem[];
  stores: readonly Store[];
  period: InsightsPeriod;
  today: string;
}): Insights {
  const { recipes, pantry, shopping, stores, today } = input;
  const from = periodStart(input.period, today);
  const byId = new Map(recipes.map((r) => [r.id, r]));
  // Only meals up to today count as "cooked"; future plans aren't history yet.
  const meals = input.meals
    .filter((m) => m.date <= today && (from === null || m.date >= from) && byId.has(m.recipeId))
    .sort((a, b) => a.date.localeCompare(b.date));
  const mealRecipes = meals.map((m) => byId.get(m.recipeId)!);

  // Recipes
  const recipeCounts = new Map<string, { count: number; lastDate: string }>();
  for (const m of meals) {
    const c = recipeCounts.get(m.recipeId) ?? { count: 0, lastDate: m.date };
    recipeCounts.set(m.recipeId, { count: c.count + 1, lastDate: m.date > c.lastDate ? m.date : c.lastDate });
  }
  const topRecipes = [...recipeCounts.entries()]
    .map(([id, c]) => ({ item: byId.get(id)!, count: c.count, lastDate: c.lastDate }))
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate) || a.item.title.localeCompare(b.item.title))
    .slice(0, 6);

  // Ingredients: how many planned meals used each one (staples left out)
  const ingCounts = new Map<string, { names: Map<string, number>; meals: number; recipes: Set<string> }>();
  for (const r of mealRecipes) {
    const seen = new Set<string>();
    for (const ing of r.ingredients) {
      if (ing.staple) continue;
      const key = normalizeIngredientName(ing.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = ingCounts.get(key) ?? { names: new Map(), meals: 0, recipes: new Set() };
      entry.meals += 1;
      entry.recipes.add(r.id);
      const display = ing.name.trim().toLowerCase();
      entry.names.set(display, (entry.names.get(display) ?? 0) + 1);
      ingCounts.set(key, entry);
    }
  }
  const topIngredients = [...ingCounts.values()]
    .map((e) => ({
      item: [...e.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      count: e.meals,
      recipes: e.recipes.size,
    }))
    .sort((a, b) => b.count - a.count || a.item.localeCompare(b.item))
    .slice(0, 10);

  // Weekly activity: the most recent 12 weeks of the period (Monday-based)
  const lastWeek = startOfWeek(today);
  const firstMeal = meals[0]?.date;
  const firstWeek = startOfWeek(from ?? firstMeal ?? today);
  const weeks: string[] = [];
  for (let w = lastWeek; w >= firstWeek && weeks.length < 12; w = addDays(w, -7)) weeks.unshift(w);
  const weekly = weeks.map((weekStart) => ({
    weekStart,
    count: meals.filter((m) => m.date >= weekStart && m.date <= addDays(weekStart, 6)).length,
  }));
  // Average over the period, but not over weeks before you started planning.
  const firstEver = input.meals.reduce<string | null>((min, m) => (m.date <= today && (min === null || m.date < min) ? m.date : min), null);
  const spanStart = firstEver === null ? today : from !== null && from > firstEver ? from : firstEver;
  const spanDays = Math.max(7, Math.round((Date.parse(today) - Date.parse(spanStart)) / 86_400_000) + 1);

  // Categories (tags) across planned meals
  const catCounts = new Map<string, Ranked<string>>();
  for (const r of mealRecipes) {
    for (const t of new Set(r.tags.map((x) => x.toLowerCase()))) {
      const e = catCounts.get(t) ?? { item: t, count: 0 };
      e.count += 1;
      catCounts.set(t, e);
    }
  }
  const categories = [...catCounts.values()].sort((a, b) => b.count - a.count || a.item.localeCompare(b.item)).slice(0, 8);

  const difficulty = { easy: 0, medium: 0, hard: 0 };
  for (const r of mealRecipes) difficulty[r.difficulty] += 1;

  // "Healthier" views — from ingredients and the user's own nutrition entries only.
  const veggiePacked = recipes
    .map((recipe) => ({ recipe, plants: plantCount(recipe) }))
    .filter((x) => x.plants > 0)
    .sort((a, b) => b.plants - a.plants || Number(isVegetarian(b.recipe)) - Number(isVegetarian(a.recipe)) || a.recipe.title.localeCompare(b.recipe.title))
    .slice(0, 5);
  const lightest = recipes
    .filter((r) => r.nutrition?.calories != null)
    .map((recipe) => ({ recipe, calories: recipe.nutrition!.calories! }))
    .sort((a, b) => a.calories - b.calories)
    .slice(0, 5);
  const mostProtein = recipes
    .filter((r) => r.nutrition?.protein != null)
    .map((recipe) => ({ recipe, protein: recipe.nutrition!.protein! }))
    .sort((a, b) => b.protein - a.protein)
    .slice(0, 5);

  // Favorites and well-rated recipes you haven't planned in 30+ days
  const lastPlanned = new Map<string, string>();
  for (const m of input.meals) if (m.date <= today && (lastPlanned.get(m.recipeId) ?? '') < m.date) lastPlanned.set(m.recipeId, m.date);
  const cutoff = addDays(today, -30);
  const revisit = recipes
    .filter((r) => (r.favorite || (r.rating ?? 0) >= 4) && (lastPlanned.get(r.id) ?? '') < cutoff)
    .map((recipe) => ({ recipe, lastDate: lastPlanned.get(recipe.id) ?? null }))
    .sort((a, b) => (b.recipe.rating ?? 0) - (a.recipe.rating ?? 0) || (a.lastDate ?? '').localeCompare(b.lastDate ?? '') || a.recipe.title.localeCompare(b.recipe.title))
    .slice(0, 5);
  const neverPlanned = recipes.filter((r) => !lastPlanned.has(r.id)).length;

  // Pantry & waste
  const soon = addDays(today, 3);
  const active = pantry.filter((p) => !p.usedUp);
  const pantryStats = {
    onHand: active.length,
    finished: pantry.filter((p) => p.usedUp && (from === null || p.updatedAt.slice(0, 10) >= from)).length,
    expired: active.filter((p) => p.expiresOn && p.expiresOn < today).map((p) => p.name),
    expiringSoon: active.filter((p) => p.expiresOn && p.expiresOn >= today && p.expiresOn <= soon).map((p) => p.name),
  };

  // Shopping list by store
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const open = shopping.filter((i) => !i.checked);
  const storeCounts = new Map<string, Ranked<string>>();
  for (const i of open) {
    const name = storeName.get(i.store) ?? 'Any store';
    const e = storeCounts.get(name) ?? { item: name, count: 0 };
    e.count += 1;
    storeCounts.set(name, e);
  }

  const vegCount = mealRecipes.filter(isVegetarian).length;
  const quickCount = mealRecipes.filter((r) => totalMinutes(r) <= QUICK_MEAL_MINUTES).length;
  return {
    mealCount: meals.length,
    distinctRecipes: recipeCounts.size,
    mealsPerWeek: meals.length ? Math.round((meals.length / (spanDays / 7)) * 10) / 10 : 0,
    vegetarianShare: share(vegCount, meals.length),
    quickShare: share(quickCount, meals.length),
    avgMinutes: meals.length ? Math.round(mealRecipes.reduce((s, r) => s + totalMinutes(r), 0) / meals.length) : null,
    topRecipes,
    topIngredients,
    weekly,
    categories,
    difficulty,
    veggiePacked,
    lightest,
    mostProtein,
    revisit,
    neverPlanned,
    pantry: pantryStats,
    shoppingByStore: [...storeCounts.values()].sort((a, b) => b.count - a.count || a.item.localeCompare(b.item)),
    shoppingOpen: open.length,
  };
}

import { normalizeIngredientName, normalizeUnit } from './ingredients';
import type { Ingredient, PantryItem, Recipe } from './schema';
import { convertQuantity } from './units';

/** True when the pantry amount is known to be less than needed (same or convertible units only). */
function enoughCheck(have: number, haveUnit: string, need: number, needUnit: string): boolean {
  if (normalizeUnit(haveUnit) === normalizeUnit(needUnit)) return have < need;
  const converted = convertQuantity(have, haveUnit, needUnit);
  return converted !== null && converted < need - 1e-9;
}

export interface MatchOptions {
  /** Count optional ingredients as missing when you don't have them. */
  countOptional: boolean;
  /** Assume you have ingredients the recipe marks as pantry staples (salt, oil...). */
  assumeStaples: boolean;
  /** ISO date (YYYY-MM-DD) used to flag expired pantry items. */
  today: string;
}

export type IngredientMatch =
  | { status: 'have'; ingredient: Ingredient; pantryItem: PantryItem; warnings: string[] }
  | { status: 'assumed-staple'; ingredient: Ingredient }
  | { status: 'missing'; ingredient: Ingredient }
  | { status: 'optional-missing'; ingredient: Ingredient };

export interface RecipeMatch {
  recipe: Recipe;
  /** "ready" only when no required ingredient is missing. */
  verdict: 'ready' | 'almost' | 'not-yet';
  items: IngredientMatch[];
  haveCount: number;
  missingCount: number;
  /** Plain-language explanation of the verdict. */
  summary: string;
}

/** Builds a lookup from normalized name → usable pantry items. */
export function indexPantry(pantry: readonly PantryItem[]): Map<string, PantryItem> {
  const map = new Map<string, PantryItem>();
  for (const item of pantry) {
    if (item.usedUp) continue;
    const key = normalizeIngredientName(item.name);
    if (key && !map.has(key)) map.set(key, item);
  }
  return map;
}

export function matchRecipe(
  recipe: Recipe,
  pantryIndex: Map<string, PantryItem>,
  options: MatchOptions,
): RecipeMatch {
  const items: IngredientMatch[] = recipe.ingredients.map((ingredient) => {
    const pantryItem = pantryIndex.get(normalizeIngredientName(ingredient.name));
    if (pantryItem) {
      const warnings: string[] = [];
      if (pantryItem.expiresOn && pantryItem.expiresOn < options.today) {
        warnings.push(`expired ${pantryItem.expiresOn}`);
      }
      if (
        pantryItem.quantity !== null &&
        ingredient.quantity !== null &&
        enoughCheck(pantryItem.quantity, pantryItem.unit, ingredient.quantity, ingredient.unit)
      ) {
        warnings.push('you may not have enough');
      }
      return { status: 'have', ingredient, pantryItem, warnings };
    }
    if (ingredient.staple && options.assumeStaples) return { status: 'assumed-staple', ingredient };
    if (ingredient.optional && !options.countOptional) return { status: 'optional-missing', ingredient };
    return { status: 'missing', ingredient };
  });

  const haveCount = items.filter((i) => i.status === 'have' || i.status === 'assumed-staple').length;
  const missing = items.filter((i) => i.status === 'missing');
  const missingCount = missing.length;
  const verdict: RecipeMatch['verdict'] =
    missingCount === 0 ? 'ready' : missingCount <= 2 ? 'almost' : 'not-yet';

  let summary: string;
  if (verdict === 'ready') {
    summary = `You have every required ingredient (${haveCount} of ${items.length} matched).`;
  } else {
    const names = missing.map((m) => m.ingredient.name);
    summary = `Missing ${missingCount} required ingredient${missingCount === 1 ? '' : 's'}: ${names.join(', ')}.`;
  }
  return { recipe, verdict, items, haveCount, missingCount, summary };
}

const VERDICT_ORDER = { ready: 0, almost: 1, 'not-yet': 2 } as const;

/** Matches every recipe and sorts: ready first, then fewest missing, then title. */
export function matchRecipes(
  recipes: readonly Recipe[],
  pantry: readonly PantryItem[],
  options: MatchOptions,
): RecipeMatch[] {
  const index = indexPantry(pantry);
  return recipes
    .map((r) => matchRecipe(r, index, options))
    .sort(
      (a, b) =>
        VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] ||
        a.missingCount - b.missingCount ||
        b.haveCount - a.haveCount ||
        a.recipe.title.localeCompare(b.recipe.title),
    );
}

import { guessCategory, normalizeIngredientName, normalizeUnit } from './ingredients';
import { scaleIngredients } from './quantity';
import type { Meal, PantryItem, Recipe } from './schema';
import { addQuantities, canCombineUnits } from './units';

/**
 * Groceries needed for a set of planned meals ("what do I need for next week?").
 * Lines are combined with the same conservative rules as the shopping list:
 * identical normalized name, compatible units (converted when needed), and both
 * quantities numeric or both blank.
 */
export interface GroceryLine {
  /** Normalized ingredient name — used to include/exclude a line when adding. */
  key: string;
  name: string;
  quantity: number | null;
  unit: string;
  category: string;
  /** True when every use of this ingredient is marked as a pantry staple. */
  staple: boolean;
  /** True when every use of this ingredient is optional. */
  optional: boolean;
  /** "Salmon Rice Bowl · Tue dinner" style labels, in plan order. */
  usedIn: string[];
  /** A matching, not-used-up pantry item, if any. */
  pantryItem: PantryItem | null;
}

export interface GroceryPlan {
  lines: GroceryLine[];
  mealCount: number;
  /** Planned meals whose recipe no longer exists (shouldn't normally happen). */
  missingRecipes: number;
}

export function planGroceries(
  meals: readonly Meal[],
  recipes: readonly Recipe[],
  pantry: readonly PantryItem[],
  labelFor: (meal: Meal, recipe: Recipe) => string = (m, r) => `${r.title} · ${m.date} ${m.slot}`,
): GroceryPlan {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const pantryIndex = new Map<string, PantryItem>();
  for (const p of pantry) {
    const k = normalizeIngredientName(p.name);
    if (!p.usedUp && k && !pantryIndex.has(k)) pantryIndex.set(k, p);
  }

  const lines: GroceryLine[] = [];
  let missingRecipes = 0;
  for (const meal of meals) {
    const recipe = byId.get(meal.recipeId);
    if (!recipe) {
      missingRecipes += 1;
      continue;
    }
    const scaled = scaleIngredients(recipe.ingredients, recipe.servings, meal.servings);
    if (!scaled.ok) continue;
    const label = labelFor(meal, recipe);
    for (const ing of scaled.ingredients) {
      const key = normalizeIngredientName(ing.name);
      const unit = normalizeUnit(ing.unit);
      const target = lines.find(
        (l) =>
          l.key === key &&
          (l.quantity === null && ing.quantity === null
            ? normalizeUnit(l.unit) === unit
            : l.quantity !== null && ing.quantity !== null && canCombineUnits(l.unit, ing.unit)),
      );
      if (target) {
        if (target.quantity !== null && ing.quantity !== null) {
          const sum = addQuantities({ quantity: target.quantity, unit: target.unit }, { quantity: ing.quantity, unit: ing.unit })!;
          target.quantity = sum.quantity;
          target.unit = sum.unit;
        }
        target.staple = target.staple && ing.staple;
        target.optional = target.optional && ing.optional;
        if (!target.usedIn.includes(label)) target.usedIn.push(label);
      } else {
        lines.push({
          key,
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          category: guessCategory(ing.name),
          staple: ing.staple,
          optional: ing.optional,
          usedIn: [label],
          pantryItem: pantryIndex.get(key) ?? null,
        });
      }
    }
  }
  return { lines, mealCount: meals.length - missingRecipes, missingRecipes };
}

/** A line is suggested for buying unless it's a staple, optional, or already in the pantry. */
export function suggestBuying(line: GroceryLine): boolean {
  return !line.staple && !line.optional && line.pantryItem === null;
}

/** The week to plan groceries for: next week from Friday onwards, otherwise this week. */
export function defaultShoppingWeekOffset(today: Date): 0 | 1 {
  const day = today.getDay(); // 0 = Sunday
  return day === 0 || day === 5 || day === 6 ? 1 : 0;
}

import { guessCategory, normalizeIngredientName, normalizeUnit } from './ingredients';
import { round } from './quantity';
import type { PantryItem, ShoppingItem, ShoppingSource } from './schema';
import { addQuantities, canCombineUnits } from './units';

export interface ShoppingAddition {
  name: string;
  quantity: number | null;
  unit: string;
  category?: string;
  /** Store id ('' = any store). Items only combine within the same store. */
  store?: string;
  source: ShoppingSource;
}

export type MergePlan =
  | { action: 'merge'; targetId: string; quantity: number | null; unit: string; sources: ShoppingSource[] }
  | { action: 'skip'; targetId: string; reason: string }
  | { action: 'create'; item: Omit<ShoppingItem, 'id' | 'createdAt' | 'updatedAt'> };

function sameSource(a: ShoppingSource, b: ShoppingSource): boolean {
  return a.kind === b.kind && a.kind === 'meal' && a.mealId !== null && a.mealId === b.mealId;
}

/**
 * Decides how an incoming ingredient joins the list. Recipe and meal-plan
 * ingredients arrive as bare names (no amount), and a bare name joins any
 * unchecked item with the same name and store, keeping that item's amount.
 * Otherwise items combine only when:
 *  - the normalized names are identical (no fuzzy matching), and
 *  - the existing item is not yet checked off and is for the same store, and
 *  - the units are identical, or the same kind of measure (weight or volume),
 *    in which case the total is converted ("1 cup + 2 tbsp" → "1 1/8 cup"), and
 *  - both quantities are numeric, or both are blank ("salt, to taste").
 * A meal-plan ingredient already on the list for the same meal is skipped,
 * so adding a week's meals twice doesn't double the list.
 */
export function planShoppingAddition(existing: readonly ShoppingItem[], add: ShoppingAddition): MergePlan {
  const key = normalizeIngredientName(add.name);
  const unit = normalizeUnit(add.unit);

  for (const item of existing) {
    if (normalizeIngredientName(item.name) !== key) continue;
    if (item.sources.some((s) => sameSource(s, add.source))) {
      return { action: 'skip', targetId: item.id, reason: 'already added for this meal' };
    }
  }

  // A bare name ("eggs", no amount) is the same line as any "eggs" on the list.
  const bare = (q: number | null, u: string) => q === null && u.trim() === '';
  const target = existing.find(
    (item) =>
      !item.checked &&
      (item.store ?? '') === (add.store ?? '') &&
      normalizeIngredientName(item.name) === key &&
      (bare(item.quantity, item.unit) || bare(add.quantity, add.unit)
        ? true
        : item.quantity === null && add.quantity === null
          ? normalizeUnit(item.unit) === unit
          : item.quantity !== null && add.quantity !== null && canCombineUnits(item.unit, add.unit)),
  );
  if (target) {
    const sum =
      bare(target.quantity, target.unit) && !bare(add.quantity, add.unit)
        ? { quantity: add.quantity === null ? null : round(add.quantity, 3), unit: add.unit.trim() }
        : target.quantity === null || add.quantity === null
          ? { quantity: target.quantity, unit: target.unit }
          : addQuantities({ quantity: target.quantity, unit: target.unit }, { quantity: add.quantity, unit: add.unit })!;
    return { action: 'merge', targetId: target.id, quantity: sum.quantity, unit: sum.unit, sources: [...target.sources, add.source] };
  }

  return {
    action: 'create',
    item: {
      name: add.name.trim(),
      quantity: add.quantity === null ? null : round(add.quantity, 3),
      unit: add.unit.trim(),
      category: add.category?.trim() || guessCategory(add.name),
      checked: false,
      store: add.store ?? '',
      sources: [add.source],
    },
  };
}

export const CATEGORY_ORDER = ['Produce', 'Meat & Fish', 'Dairy & Eggs', 'Bakery', 'Pantry', 'Spices & Condiments', 'Other'];

export function groupByCategory<T extends { category: string }>(items: readonly T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const cat = item.category || 'Other';
    groups.set(cat, [...(groups.get(cat) ?? []), item]);
  }
  const rank = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i === -1 ? CATEGORY_ORDER.length - 1 : i;
  };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}

/**
 * What checking off a shopping item means for the pantry: bring back a
 * finished item with the same name, leave an item you already have alone,
 * or add a new one.
 */
export type PantryRestock =
  | { action: 'restock'; item: PantryItem }
  | { action: 'have'; item: PantryItem }
  | { action: 'create' };

export function planPantryRestock(pantry: readonly PantryItem[], name: string): PantryRestock {
  const key = normalizeIngredientName(name);
  const same = pantry.filter((p) => normalizeIngredientName(p.name) === key);
  const active = same.find((p) => !p.usedUp);
  if (active) return { action: 'have', item: active };
  const finished = same.find((p) => p.usedUp);
  return finished ? { action: 'restock', item: finished } : { action: 'create' };
}

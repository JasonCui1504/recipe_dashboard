import { describe, expect, it } from 'vitest';
import { defaultShoppingWeekOffset, planGroceries, suggestBuying } from '../src/shared/planning';
import type { Meal } from '../src/shared/schema';
import { ing, pantryItem, recipe } from './helpers';

const meal = (id: string, recipeId: string, servings: number, date = '2026-10-19', slot = 'dinner'): Meal => ({
  id,
  recipeId,
  servings,
  date,
  slot,
  note: '',
  createdAt: '',
});

const pasta = recipe({
  id: 'pasta',
  title: 'Pasta',
  servings: 2,
  ingredients: [ing(200, 'g', 'pasta'), ing(2, 'cloves', 'garlic'), ing(null, '', 'salt', { staple: true }), ing(1, 'tbsp', 'parmesan', { optional: true })],
});
const soup = recipe({
  id: 'soup',
  title: 'Soup',
  servings: 4,
  ingredients: [ing(4, 'cloves', 'Garlic'), ing(1, 'cup', 'lentils'), ing(1, '', 'onion'), ing(null, '', 'salt', { staple: true })],
});

describe('planGroceries', () => {
  it('scales each meal and combines identical ingredients across meals', () => {
    const plan = planGroceries([meal('m1', 'pasta', 4), meal('m2', 'soup', 2, '2026-10-20')], [pasta, soup], []);
    const garlic = plan.lines.find((l) => l.key === 'garlic')!;
    expect(garlic.quantity).toBe(6); // 4 cloves (pasta ×2) + 2 cloves (soup ×½)
    expect(garlic.usedIn).toEqual(['Pasta · 2026-10-19 dinner', 'Soup · 2026-10-20 dinner']);
    expect(plan.lines.find((l) => l.key === 'pasta')!.quantity).toBe(400);
    expect(plan.lines.find((l) => l.key === 'lentil')!.quantity).toBe(0.5);
    expect(plan.mealCount).toBe(2);
  });

  it('keeps different units apart', () => {
    const other = recipe({ id: 'o', servings: 1, ingredients: [ing(1, 'head', 'garlic')] });
    const plan = planGroceries([meal('m1', 'pasta', 2), meal('m2', 'o', 1)], [pasta, other], []);
    expect(plan.lines.filter((l) => l.key === 'garlic').map((l) => l.unit)).toEqual(['cloves', 'head']);
  });

  it('flags pantry items, staples and optional ingredients so they are not suggested', () => {
    const plan = planGroceries([meal('m1', 'pasta', 2)], [pasta], [pantryItem('Garlic', { quantity: 1, unit: 'bulb' }), pantryItem('pasta', { usedUp: true })]);
    const by = (k: string) => plan.lines.find((l) => l.key === k)!;
    expect(by('garlic').pantryItem?.name).toBe('Garlic');
    expect(suggestBuying(by('garlic'))).toBe(false);
    expect(suggestBuying(by('salt'))).toBe(false);
    expect(suggestBuying(by('parmesan'))).toBe(false);
    expect(by('pasta').pantryItem).toBeNull(); // used-up items don't count
    expect(suggestBuying(by('pasta'))).toBe(true);
  });

  it('a staple used as a regular ingredient elsewhere stays suggested', () => {
    const r = recipe({ id: 'r', servings: 1, ingredients: [ing(1, 'tsp', 'salt')] });
    const s = recipe({ id: 's', servings: 1, ingredients: [ing(1, 'tsp', 'salt', { staple: true })] });
    const plan = planGroceries([meal('a', 'r', 1), meal('b', 's', 1)], [r, s], []);
    expect(plan.lines[0]).toMatchObject({ quantity: 2, staple: false });
  });

  it('counts meals whose recipe is gone', () => {
    expect(planGroceries([meal('m1', 'nope', 2)], [pasta], [])).toMatchObject({ mealCount: 0, missingRecipes: 1, lines: [] });
  });
});

describe('defaultShoppingWeekOffset', () => {
  it('looks at next week from Friday to Sunday', () => {
    expect(defaultShoppingWeekOffset(new Date(2026, 9, 14))).toBe(0); // Wednesday
    expect(defaultShoppingWeekOffset(new Date(2026, 9, 16))).toBe(1); // Friday
    expect(defaultShoppingWeekOffset(new Date(2026, 9, 17))).toBe(1); // Saturday
    expect(defaultShoppingWeekOffset(new Date(2026, 9, 18))).toBe(1); // Sunday
    expect(defaultShoppingWeekOffset(new Date(2026, 9, 19))).toBe(0); // Monday
  });
});

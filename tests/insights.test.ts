import { describe, expect, it } from 'vitest';
import { computeInsights, periodStart, plantCount } from '../src/shared/insights';
import type { Meal } from '../src/shared/schema';
import { ing, pantryItem, recipe } from './helpers';

const today = '2026-10-19'; // a Monday
const meal = (id: string, recipeId: string, date: string): Meal => ({ id, recipeId, date, slot: 'dinner', servings: 2, note: '', createdAt: '' });

const curry = recipe({
  id: 'curry',
  title: 'Chickpea Curry',
  tags: ['dinner', 'curry'],
  dietary: ['vegan'],
  prepMinutes: 10,
  cookMinutes: 25,
  ingredients: [ing(1, '', 'onion'), ing(2, 'cans', 'chickpeas'), ing(3, 'cups', 'spinach'), ing(3, 'cloves', 'garlic'), ing(null, '', 'salt', { staple: true })],
});
const chicken = recipe({
  id: 'chicken',
  title: 'Garlic Chicken',
  tags: ['dinner'],
  dietary: [],
  difficulty: 'medium',
  prepMinutes: 10,
  cookMinutes: 10,
  favorite: true,
  ingredients: [ing(2, '', 'chicken breasts'), ing(4, 'cloves', 'garlic'), ing(1, 'tbsp', 'olive oil', { staple: true })],
  nutrition: { calories: 450, protein: 52, carbs: null, fat: null, basis: 'user-entered' },
});
const oats = recipe({ id: 'oats', title: 'Oats', tags: ['breakfast'], dietary: ['vegetarian'], rating: 5, ingredients: [ing(0.5, 'cup', 'rolled oats'), ing(0.5, 'cup', 'berries')] });

const base = {
  recipes: [curry, chicken, oats],
  meals: [
    meal('1', 'curry', '2026-10-01'),
    meal('2', 'curry', '2026-10-08'),
    meal('3', 'chicken', '2026-10-15'),
    meal('4', 'curry', '2026-10-18'),
    meal('5', 'chicken', '2026-10-25'), // future: not counted
    meal('6', 'oats', '2026-06-01'), // outside 4 weeks
    meal('7', 'deleted-recipe', '2026-10-10'),
  ],
  pantry: [pantryItem('milk', { expiresOn: '2026-10-10' }), pantryItem('eggs', { expiresOn: '2026-10-21' }), pantryItem('rice', { usedUp: true, updatedAt: '2026-10-12T10:00:00.000Z' })],
  shopping: [],
  stores: [],
  today,
};

describe('computeInsights', () => {
  it('counts only past meals in the period, for existing recipes', () => {
    const i = computeInsights({ ...base, period: '4w' });
    expect(periodStart('4w', today)).toBe('2026-09-22');
    expect(i.mealCount).toBe(4);
    expect(i.distinctRecipes).toBe(2);
    expect(i.topRecipes.map((r) => [r.item.id, r.count, r.lastDate])).toEqual([
      ['curry', 3, '2026-10-18'],
      ['chicken', 1, '2026-10-15'],
    ]);
    expect(computeInsights({ ...base, period: 'all' }).mealCount).toBe(5);
  });

  it('ranks ingredients by how many meals used them, without staples', () => {
    const i = computeInsights({ ...base, period: '4w' });
    expect(i.topIngredients[0]).toEqual({ item: 'garlic', count: 4, recipes: 2 });
    expect(i.topIngredients.some((x) => x.item === 'salt' || x.item === 'olive oil')).toBe(false);
  });

  it('computes shares, averages and weekly counts', () => {
    const i = computeInsights({ ...base, period: '4w' });
    expect(i.vegetarianShare).toBe(0.75);
    expect(i.avgMinutes).toBe(31); // (35*3 + 20) / 4 = 31.25
    expect(i.quickShare).toBe(0.25);
    expect(i.weekly.map((w) => w.weekStart)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
    expect(i.weekly.map((w) => w.count)).toEqual([0, 1, 1, 2, 0]);
    expect(i.difficulty).toEqual({ easy: 3, medium: 1, hard: 0 });
    expect(i.categories[0]).toEqual({ item: 'dinner', count: 4 });
  });

  it('finds veggie-packed recipes from ingredients and nutrition only from user entries', () => {
    expect(plantCount(curry)).toBe(4); // onion, chickpeas, spinach, garlic
    const i = computeInsights({ ...base, period: '4w' });
    expect(i.veggiePacked[0].recipe.id).toBe('curry');
    expect(i.lightest).toEqual([{ recipe: chicken, calories: 450 }]);
    expect(i.mostProtein).toEqual([{ recipe: chicken, protein: 52 }]);
  });

  it('suggests favorites and top-rated recipes not cooked in 30 days', () => {
    const i = computeInsights({ ...base, period: '4w' });
    // chicken was planned 4 days ago; oats (5 stars) last in June.
    expect(i.revisit.map((r) => [r.recipe.id, r.lastDate])).toEqual([['oats', '2026-06-01']]);
    expect(i.neverPlanned).toBe(0);
  });

  it('summarizes the pantry', () => {
    const i = computeInsights({ ...base, period: '4w' });
    expect(i.pantry).toEqual({ onHand: 2, finished: 1, expired: ['milk'], expiringSoon: ['eggs'] });
  });

  it('handles an empty cookbook', () => {
    const i = computeInsights({ recipes: [], meals: [], pantry: [], shopping: [], stores: [], period: 'all', today });
    expect(i).toMatchObject({ mealCount: 0, mealsPerWeek: 0, vegetarianShare: null, avgMinutes: null, topRecipes: [], weekly: [{ weekStart: today, count: 0 }] });
  });
});

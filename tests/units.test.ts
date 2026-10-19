import { describe, expect, it } from 'vitest';
import { planShoppingAddition } from '../src/shared/shopping';
import { addQuantities, canCombineUnits, convertQuantity, convertibleUnit, toSystem } from '../src/shared/units';
import { planGroceries } from '../src/shared/planning';
import type { ShoppingSource } from '../src/shared/schema';
import { ing, recipe } from './helpers';

describe('convertQuantity', () => {
  it('converts within weight and within volume', () => {
    expect(convertQuantity(1, 'kg', 'g')).toBe(1000);
    expect(convertQuantity(1, 'lb', 'oz')).toBeCloseTo(16, 6);
    expect(convertQuantity(1, 'cup', 'tbsp')).toBeCloseTo(16, 6);
    expect(convertQuantity(1, 'tbsp', 'tsp')).toBeCloseTo(3, 6);
    expect(convertQuantity(1, 'L', 'ml')).toBe(1000);
    expect(convertQuantity(1, 'cups', 'ml')).toBeCloseTo(236.59, 2);
    expect(convertQuantity(2, 'fl oz', 'tbsp')).toBeCloseTo(4, 6);
  });
  it('never converts between weight and volume, or non-measures', () => {
    expect(convertQuantity(1, 'cup', 'g')).toBeNull();
    expect(convertQuantity(1, 'oz', 'fl oz')).toBeNull(); // weight ounce vs fluid ounce
    expect(convertQuantity(2, 'cloves', 'g')).toBeNull();
    expect(convertibleUnit('can')).toBeNull();
    expect(convertibleUnit('')).toBeNull();
  });
});

describe('addQuantities', () => {
  it('adds identical units as-is', () => {
    expect(addQuantities({ quantity: 2, unit: 'cloves' }, { quantity: 1, unit: 'clove' })).toEqual({ quantity: 3, unit: 'cloves' });
  });
  it('converts to the larger unit', () => {
    expect(addQuantities({ quantity: 1, unit: 'cup' }, { quantity: 2, unit: 'tbsp' })).toEqual({ quantity: 1.125, unit: 'cup' });
    expect(addQuantities({ quantity: 500, unit: 'g' }, { quantity: 1, unit: 'kg' })).toEqual({ quantity: 1.5, unit: 'kg' });
    expect(addQuantities({ quantity: 1, unit: 'tsp' }, { quantity: 1, unit: 'tbsp' })).toEqual({ quantity: 1.333, unit: 'tbsp' });
  });
  it('refuses incompatible units', () => {
    expect(addQuantities({ quantity: 1, unit: 'cup' }, { quantity: 100, unit: 'g' })).toBeNull();
    expect(canCombineUnits('cup', 'g')).toBe(false);
    expect(canCombineUnits('', '')).toBe(true);
    expect(canCombineUnits('g', 'lb')).toBe(true);
  });
});

describe('combining with conversion', () => {
  const manual: ShoppingSource = { kind: 'manual', recipeId: null, mealId: null, label: '' };
  it('merges compatible units on the shopping list', () => {
    const plan = planShoppingAddition(
      [{ id: 'a', name: 'soy sauce', quantity: 2, unit: 'tbsp', category: '', checked: false, store: '', sources: [manual], createdAt: '', updatedAt: '' }],
      { name: 'Soy sauce', quantity: 0.25, unit: 'cup', source: manual },
    );
    expect(plan).toMatchObject({ action: 'merge', quantity: 0.375, unit: 'cup' });
  });
  it('merges compatible units in a grocery plan', () => {
    const a = recipe({ id: 'a', servings: 1, ingredients: [ing(500, 'g', 'flour')] });
    const b = recipe({ id: 'b', servings: 1, ingredients: [ing(1, 'kg', 'flour')] });
    const meal = (id: string, recipeId: string) => ({ id, recipeId, date: '2026-10-19', slot: 'dinner', servings: 1, note: '', createdAt: '' });
    const plan = planGroceries([meal('1', 'a'), meal('2', 'b')], [a, b], []);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatchObject({ quantity: 1.5, unit: 'kg' });
  });
});

describe('toSystem (recipe display)', () => {
  it('leaves amounts alone in "as written" mode or for non-measures', () => {
    expect(toSystem(2, 'cups', 'original')).toEqual({ quantity: 2, unit: 'cups', converted: false });
    expect(toSystem(3, 'cloves', 'metric')).toEqual({ quantity: 3, unit: 'cloves', converted: false });
    expect(toSystem(null, 'cup', 'metric')).toEqual({ quantity: null, unit: 'cup', converted: false });
  });
  it('converts US measures to metric, keeping spoons', () => {
    expect(toSystem(1, 'cup', 'metric')).toEqual({ quantity: 235, unit: 'ml', converted: true });
    expect(toSystem(5, 'cups', 'metric')).toEqual({ quantity: 1.18, unit: 'l', converted: true });
    expect(toSystem(8, 'oz', 'metric')).toEqual({ quantity: 225, unit: 'g', converted: true });
    expect(toSystem(2, 'tbsp', 'metric').converted).toBe(false);
  });
  it('converts metric to US measures', () => {
    expect(toSystem(250, 'g', 'us')).toEqual({ quantity: 8.75, unit: 'oz', converted: true });
    expect(toSystem(1, 'kg', 'us')).toEqual({ quantity: 2.25, unit: 'lb', converted: true });
    expect(toSystem(240, 'ml', 'us')).toEqual({ quantity: 1, unit: 'cup', converted: true });
    expect(toSystem(30, 'ml', 'us')).toEqual({ quantity: 2, unit: 'tbsp', converted: true });
    expect(toSystem(5, 'ml', 'us')).toEqual({ quantity: 1, unit: 'tsp', converted: true });
  });
});

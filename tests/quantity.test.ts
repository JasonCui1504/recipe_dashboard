import { describe, expect, it } from 'vitest';
import { describeIngredient, formatQuantity, parseQuantity, scaleIngredients } from '../src/shared/quantity';
import { ing } from './helpers';

describe('parseQuantity', () => {
  it.each([
    ['2', 2],
    ['1.5', 1.5],
    ['0,5', 0.5],
    ['1/2', 0.5],
    ['1 1/2', 1.5],
    ['  3/4 ', 0.75],
    ['½', 0.5],
    ['1½', 1.5],
    ['.25', 0.25],
  ])('parses %j', (input, expected) => {
    expect(parseQuantity(input)).toBeCloseTo(expected, 4);
  });

  it.each(['', '   ', 'a pinch', '2-3', '1/0', 'abc', '1 2'])('returns null for %j', (input) => {
    expect(parseQuantity(input)).toBeNull();
  });
});

describe('formatQuantity', () => {
  it.each([
    [2, '2'],
    [0.5, '1/2'],
    [1.5, '1 1/2'],
    [1 / 3, '1/3'],
    [2 / 3, '2/3'],
    [0.25, '1/4'],
    [0.125, '1/8'],
    [1.999, '2'],
    [0.4, '0.4'],
    [1.23456, '1.23'],
    [300, '300'],
    [333.333, '333.3'],
    [null, ''],
  ])('formats %s as %j', (value, expected) => {
    expect(formatQuantity(value)).toBe(expected);
  });
});

describe('scaleIngredients', () => {
  const ingredients = [ing(1, 'cup', 'rice'), ing(0.5, 'tsp', 'salt'), ing(null, '', 'pepper'), ing(3, '', 'eggs')];

  it('scales numeric quantities proportionally', () => {
    const r = scaleIngredients(ingredients, 2, 4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.factor).toBe(2);
    expect(r.ingredients.map((i) => i.quantity)).toEqual([2, 1, null, 6]);
  });

  it('handles fractional factors and keeps clean fractions', () => {
    const r = scaleIngredients(ingredients, 4, 3);
    if (!r.ok) throw new Error('expected ok');
    expect(r.ingredients[0].quantity).toBe(0.75);
    expect(formatQuantity(r.ingredients[0].quantity)).toBe('3/4');
    expect(formatQuantity(r.ingredients[3].quantity)).toBe('2 1/4');
  });

  it('rounds to sensible precision (no floating-point noise)', () => {
    const r = scaleIngredients([ing(1, 'cup', 'stock')], 3, 1);
    if (!r.ok) throw new Error('expected ok');
    expect(r.ingredients[0].quantity).toBe(0.333);
    expect(formatQuantity(r.ingredients[0].quantity)).toBe('1/3');
    const r2 = scaleIngredients([ing(0.1, 'l', 'water')], 1, 3);
    if (!r2.ok) throw new Error('expected ok');
    expect(r2.ingredients[0].quantity).toBe(0.3);
  });

  it('leaves ingredients without a quantity untouched', () => {
    const r = scaleIngredients(ingredients, 2, 10);
    if (!r.ok) throw new Error('expected ok');
    expect(r.ingredients[2]).toEqual(ingredients[2]);
  });

  it('never changes units or names, and never mutates the input', () => {
    const before = JSON.stringify(ingredients);
    const r = scaleIngredients(ingredients, 2, 5);
    if (!r.ok) throw new Error('expected ok');
    expect(r.ingredients.map((i) => [i.unit, i.name])).toEqual(ingredients.map((i) => [i.unit, i.name]));
    expect(JSON.stringify(ingredients)).toBe(before);
  });

  it.each([0, -2, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid target servings %s', (target) => {
    const r = scaleIngredients(ingredients, 2, target);
    expect(r.ok).toBe(false);
  });

  it('rejects an invalid original serving count', () => {
    expect(scaleIngredients(ingredients, 0, 2).ok).toBe(false);
  });
});

describe('describeIngredient', () => {
  it('builds a readable line', () => {
    expect(describeIngredient(ing(1.5, 'cups', 'rice', { note: 'rinsed' }))).toBe('1 1/2 cups rice, rinsed');
    expect(describeIngredient(ing(null, '', 'salt', { note: 'to taste' }))).toBe('salt, to taste');
  });
});

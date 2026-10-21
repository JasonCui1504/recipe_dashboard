import { describe, expect, it } from 'vitest';
import { addDays, formatWeekRange, isValidIsoDate, startOfWeek, weekDays } from '../src/shared/dates';
import { parseIngredientLine } from '../src/shared/parse';
import type { ShoppingItem, ShoppingSource } from '../src/shared/schema';
import { groupByCategory, planPantryRestock, planShoppingAddition } from '../src/shared/shopping';
import { pantryItem } from './helpers';

const manual: ShoppingSource = { kind: 'manual', recipeId: null, mealId: null, label: 'Added by you' };
const item = (name: string, quantity: number | null, unit: string, extra: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: `i-${name}-${unit}`,
  name,
  quantity,
  unit,
  category: 'Other',
  checked: false,
  store: '',
  sources: [manual],
  createdAt: '',
  updatedAt: '',
  ...extra,
});

describe('planShoppingAddition', () => {
  it('combines identical names with the same unit', () => {
    const plan = planShoppingAddition([item('Rice', 1, 'cup')], { name: 'rice', quantity: 2, unit: 'cups', source: manual });
    expect(plan).toMatchObject({ action: 'merge', targetId: 'i-Rice-cup', quantity: 3 });
  });
  it('keeps incompatible units separate', () => {
    const plan = planShoppingAddition([item('rice', 1, 'cup')], { name: 'rice', quantity: 200, unit: 'g', source: manual });
    expect(plan.action).toBe('create');
  });
  it('does not combine similar but different ingredients', () => {
    const plan = planShoppingAddition([item('salt', 1, 'tsp')], { name: 'garlic salt', quantity: 1, unit: 'tsp', source: manual });
    expect(plan.action).toBe('create');
  });
  it('keeps the same ingredient separate for different stores', () => {
    const plan = planShoppingAddition([item('eggs', 6, '', { store: 'costco' })], { name: 'eggs', quantity: 2, unit: '', store: '', source: manual });
    expect(plan).toMatchObject({ action: 'create', item: { store: '' } });
    expect(planShoppingAddition([item('eggs', 6, '', { store: 'costco' })], { name: 'eggs', quantity: 2, unit: '', store: 'costco', source: manual })).toMatchObject({
      action: 'merge',
      quantity: 8,
    });
  });

  it('does not merge into checked-off items', () => {
    const plan = planShoppingAddition([item('eggs', 6, '', { checked: true })], { name: 'eggs', quantity: 2, unit: '', source: manual });
    expect(plan.action).toBe('create');
  });
  it('combines bare names with any same-name item, keeping the amount', () => {
    expect(planShoppingAddition([item('salt', null, '')], { name: 'Salt', quantity: null, unit: '', source: manual })).toMatchObject({ action: 'merge', quantity: null });
    expect(planShoppingAddition([item('flour', 2, 'cup')], { name: 'Flour', quantity: null, unit: '', source: manual })).toMatchObject({ action: 'merge', quantity: 2, unit: 'cup' });
    expect(planShoppingAddition([item('salt', null, '')], { name: 'salt', quantity: 1, unit: '', source: manual })).toMatchObject({ action: 'merge', quantity: 1 });
  });
  it('never mixes a numeric amount with a blank one that has a unit', () => {
    expect(planShoppingAddition([item('salt', null, 'pinch')], { name: 'salt', quantity: 1, unit: 'tsp', source: manual }).action).toBe('create');
  });
  it('skips an ingredient already added for the same planned meal', () => {
    const meal: ShoppingSource = { kind: 'meal', recipeId: 'r', mealId: 'm1', label: 'x' };
    const plan = planShoppingAddition([item('eggs', 2, '', { sources: [meal] })], { name: 'eggs', quantity: 2, unit: '', source: meal });
    expect(plan.action).toBe('skip');
  });
  it('creates new items with a guessed category and the source attached', () => {
    const plan = planShoppingAddition([], { name: ' Carrots ', quantity: 2, unit: '', source: manual });
    expect(plan).toMatchObject({ action: 'create', item: { name: 'Carrots', category: 'Produce', sources: [manual] } });
  });
  it('groups by category in aisle order', () => {
    const groups = groupByCategory([{ category: 'Other' }, { category: 'Produce' }, { category: '' }, { category: 'Dairy & Eggs' }]);
    expect(groups.map(([c]) => c)).toEqual(['Produce', 'Dairy & Eggs', 'Other']);
  });
});

describe('dates', () => {
  it('finds Monday as the week start', () => {
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12'); // Sunday → previous Monday
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12');
    expect(startOfWeek('2026-10-14')).toBe('2026-10-12');
  });
  it('navigates across months and years', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDays('2026-03-02', -7)).toBe('2026-02-23');
    expect(weekDays('2026-12-28')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  });
  it('validates ISO dates', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('nope')).toBe(false);
  });
  it('formats a week range', () => {
    expect(formatWeekRange('2026-10-12')).toMatch(/12 – 18, 2026$/);
    expect(formatWeekRange('2026-12-28')).toMatch(/2026 – .* 3, 2027$/);
  });
});

describe('parseIngredientLine', () => {
  it('reads quantity, unit, name and note', () => {
    expect(parseIngredientLine('1 1/2 cups rice, rinsed')).toMatchObject({ quantity: 1.5, unit: 'cups', name: 'rice', note: 'rinsed' });
    expect(parseIngredientLine('- 2 eggs')).toMatchObject({ quantity: 2, unit: '', name: 'eggs' });
    expect(parseIngredientLine('salt, to taste')).toMatchObject({ quantity: null, unit: '', name: 'salt', note: 'to taste' });
    expect(parseIngredientLine('1 tbsp sesame oil (optional)')).toMatchObject({ quantity: 1, unit: 'tbsp', name: 'sesame oil', optional: true });
    expect(parseIngredientLine('2 large onions')).toMatchObject({ quantity: 2, unit: '', name: 'large onions' });
    expect(parseIngredientLine('   ')).toBeNull();
  });
});

describe('planPantryRestock', () => {
  it('adds a new pantry item when there is none', () => {
    expect(planPantryRestock([pantryItem('rice')], 'Lemons')).toEqual({ action: 'create' });
  });
  it('restocks a finished item with the same name', () => {
    const lemon = pantryItem('lemon', { usedUp: true });
    expect(planPantryRestock([lemon], 'Lemons')).toEqual({ action: 'restock', item: lemon });
  });
  it('leaves an item you already have alone', () => {
    const old = pantryItem('egg', { id: 'old', usedUp: true });
    const fresh = pantryItem('eggs', { id: 'fresh' });
    expect(planPantryRestock([old, fresh], 'Eggs')).toEqual({ action: 'have', item: fresh });
  });
});

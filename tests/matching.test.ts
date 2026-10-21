import { describe, expect, it } from 'vitest';
import { guessCategory, normalizeIngredientName, normalizeUnit, unitsCompatible } from '../src/shared/ingredients';
import { collectMissingIngredients, matchRecipe, matchRecipes, indexPantry } from '../src/shared/matching';
import { ing, pantryItem, recipe } from './helpers';

const opts = { countOptional: false, assumeStaples: true, today: '2026-06-01' };

describe('normalizeIngredientName', () => {
  it('ignores case, whitespace and punctuation', () => {
    expect(normalizeIngredientName('  Olive   OIL! ')).toBe('olive oil');
  });
  it('folds simple plurals', () => {
    expect(normalizeIngredientName('Tomatoes')).toBe('tomato');
    expect(normalizeIngredientName('eggs')).toBe('egg');
    expect(normalizeIngredientName('berries')).toBe('berry');
    expect(normalizeIngredientName('green onions')).toBe('green onion');
    expect(normalizeIngredientName('asparagus')).toBe('asparagus');
    expect(normalizeIngredientName('glass')).toBe('glass');
  });
  it('applies the explicit alias map', () => {
    expect(normalizeIngredientName('Scallions')).toBe('green onion');
    expect(normalizeIngredientName('garbanzo beans')).toBe('chickpea');
  });
  it('does not treat distinct ingredients as equal', () => {
    expect(normalizeIngredientName('garlic salt')).not.toBe(normalizeIngredientName('salt'));
    expect(normalizeIngredientName('olive oil')).not.toBe(normalizeIngredientName('oil'));
  });
});

describe('units', () => {
  it('normalizes common spellings', () => {
    expect(normalizeUnit('Tablespoons')).toBe('tbsp');
    expect(normalizeUnit('T')).toBe('tbsp');
    expect(normalizeUnit('t')).toBe('tsp');
    expect(normalizeUnit('cups')).toBe('cup');
    expect(normalizeUnit('g')).toBe('g');
    expect(normalizeUnit('')).toBe('');
  });
  it('only treats identical units as compatible', () => {
    expect(unitsCompatible('cup', 'cups')).toBe(true);
    expect(unitsCompatible('g', 'kg')).toBe(false);
    expect(unitsCompatible('cup', 'g')).toBe(false);
  });
  it('guesses grocery categories, preferring the most specific keyword', () => {
    expect(guessCategory('Red onion')).toBe('Produce');
    expect(guessCategory('sesame oil')).toBe('Spices & Condiments');
    expect(guessCategory('chicken thighs')).toBe('Meat & Fish');
    expect(guessCategory('crushed tomatoes')).toBe('Pantry');
    expect(guessCategory('mystery item')).toBe('Other');
  });
});

describe('matchRecipe', () => {
  const r = recipe({
    ingredients: [
      ing(2, '', 'eggs'),
      ing(1, 'cup', 'flour'),
      ing(null, '', 'salt', { staple: true }),
      ing(1, 'tbsp', 'chives', { optional: true }),
    ],
  });

  it('is ready when every required ingredient is in the pantry', () => {
    const m = matchRecipe(r, indexPantry([pantryItem('Eggs'), pantryItem('flour')]), opts);
    expect(m.verdict).toBe('ready');
    expect(m.missingCount).toBe(0);
    expect(m.items.map((i) => i.status)).toEqual(['have', 'have', 'assumed-staple', 'optional-missing']);
    expect(m.summary).toMatch(/every required ingredient/);
  });

  it('lists missing ingredients and never claims ready', () => {
    const m = matchRecipe(r, indexPantry([pantryItem('eggs')]), opts);
    expect(m.verdict).toBe('almost');
    expect(m.missingCount).toBe(1);
    expect(m.summary).toBe('Missing 1 required ingredient: flour.');
  });

  it('can count optional ingredients and staples as missing', () => {
    const m = matchRecipe(r, indexPantry([pantryItem('eggs'), pantryItem('flour')]), {
      ...opts,
      countOptional: true,
      assumeStaples: false,
    });
    expect(m.verdict).toBe('almost');
    expect(m.items.filter((i) => i.status === 'missing').map((i) => i.ingredient.name)).toEqual(['salt', 'chives']);
  });

  it('does not match similar but different ingredients', () => {
    const plain = recipe({ ingredients: [ing(1, 'tsp', 'salt')] });
    const m = matchRecipe(plain, indexPantry([pantryItem('garlic salt')]), opts);
    expect(m.verdict).toBe('almost');
    expect(m.items[0].status).toBe('missing');
  });

  it('ignores used-up pantry items', () => {
    const m = matchRecipe(r, indexPantry([pantryItem('eggs', { usedUp: true }), pantryItem('flour')]), opts);
    expect(m.missingCount).toBe(1);
  });

  it('warns about expired items and insufficient same-unit quantities', () => {
    const m = matchRecipe(
      r,
      indexPantry([pantryItem('eggs', { expiresOn: '2026-05-01' }), pantryItem('flour', { quantity: 0.5, unit: 'cups' })]),
      opts,
    );
    const [eggs, flour] = m.items;
    expect(eggs.status === 'have' && eggs.warnings).toEqual(['expired 2026-05-01']);
    expect(flour.status === 'have' && flour.warnings).toEqual(['you may not have enough']);
  });

  it('marks three or more missing as not yet', () => {
    const m = matchRecipe(recipe({ ingredients: [ing(1, '', 'a'), ing(1, '', 'b'), ing(1, '', 'c')] }), indexPantry([]), opts);
    expect(m.verdict).toBe('not-yet');
  });
});

describe('matchRecipes', () => {
  it('sorts ready recipes first, then by fewest missing — deterministically', () => {
    const a = recipe({ id: 'a', title: 'A', ingredients: [ing(1, '', 'x'), ing(1, '', 'y'), ing(1, '', 'z')] });
    const b = recipe({ id: 'b', title: 'B', ingredients: [ing(1, '', 'egg')] });
    const c = recipe({ id: 'c', title: 'C', ingredients: [ing(1, '', 'egg'), ing(1, '', 'milk')] });
    const run = () => matchRecipes([a, b, c], [pantryItem('egg')], opts).map((m) => m.recipe.id);
    expect(run()).toEqual(['b', 'c', 'a']);
    expect(run()).toEqual(run());
  });
});

describe('collectMissingIngredients', () => {
  it('lists missing ingredients across recipes, most useful first', () => {
    const omelette = recipe({ id: 'om', title: 'Omelette', ingredients: [ing(2, '', 'eggs'), ing(null, '', 'chives')] });
    const pancakes = recipe({ id: 'pc', title: 'Pancakes', ingredients: [ing(1, 'cup', 'flour'), ing(2, '', 'eggs'), ing(1, 'cup', 'milk')] });
    const salad = recipe({ id: 'sa', title: 'Salad', ingredients: [ing(1, '', 'lettuce'), ing(null, '', 'chive', { optional: true })] });
    const matches = matchRecipes([omelette, pancakes, salad], [pantryItem('eggs'), pantryItem('flour')], opts);
    const missing = collectMissingIngredients(matches);
    expect(missing.map((m) => m.name)).toEqual(['chives', 'lettuce', 'milk']);
    expect(missing[0].unlocks.map((r) => r.title)).toEqual(['Omelette']);
    // Optional ingredients aren't counted as missing.
    expect(missing[0].recipes.map((r) => r.title)).toEqual(['Omelette']);
  });
  it('merges plurals and keeps recipes that need several things', () => {
    const a = recipe({ id: 'a', title: 'A', ingredients: [ing(1, '', 'tomatoes'), ing(1, '', 'basil')] });
    const b = recipe({ id: 'b', title: 'B', ingredients: [ing(1, '', 'tomato')] });
    const missing = collectMissingIngredients(matchRecipes([a, b], [], opts));
    expect(missing[0]).toMatchObject({ key: 'tomato', name: 'tomato' });
    expect(missing[0].recipes.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(missing[0].unlocks.map((r) => r.id)).toEqual(['b']);
  });
});

import { describe, expect, it } from 'vitest';
import { collectTags, filterRecipes, matchesQuickFilter, searchRecipes, sortRecipes } from '../src/shared/search';
import { ing, recipe } from './helpers';

const pasta = recipe({ id: 'p', title: 'Tomato Pasta', tags: ['dinner', 'pasta'], dietary: ['vegetarian'], prepMinutes: 5, cookMinutes: 20, ingredients: [ing(1, '', 'tomato'), ing(200, 'g', 'penne')], createdAt: '2026-01-03' });
const chicken = recipe({ id: 'c', title: 'Garlic Chicken', tags: ['dinner', 'High-Protein'], dietary: [], prepMinutes: 10, cookMinutes: 40, favorite: true, rating: 5, ingredients: [ing(2, '', 'chicken breasts'), ing(3, 'cloves', 'garlic')], createdAt: '2026-01-02' });
const oats = recipe({ id: 'o', title: 'Overnight Oats', tags: ['breakfast'], dietary: ['Vegan'], prepMinutes: 5, cookMinutes: 0, difficulty: 'easy', ingredients: [ing(0.5, 'cup', 'oats')], createdAt: '2026-01-01' });
const all = [pasta, chicken, oats];

describe('searchRecipes', () => {
  it('matches title, ingredients and tags case-insensitively', () => {
    expect(searchRecipes(all, 'PASTA').map((r) => r.id)).toEqual(['p']);
    expect(searchRecipes(all, 'garlic').map((r) => r.id)).toEqual(['c']);
    expect(searchRecipes(all, 'breakfast').map((r) => r.id)).toEqual(['o']);
  });
  it('requires every term to match', () => {
    expect(searchRecipes(all, 'dinner tomato').map((r) => r.id)).toEqual(['p']);
    expect(searchRecipes(all, 'dinner oats')).toEqual([]);
  });
  it('returns everything for an empty query', () => {
    expect(searchRecipes(all, '   ')).toHaveLength(3);
  });
  it('ranks title hits first', () => {
    const r = recipe({ id: 'x', title: 'Chicken Soup', ingredients: [ing(1, '', 'carrot')], tags: [] });
    const z = recipe({ id: 'z', title: 'Zesty Salad', ingredients: [ing(1, '', 'chicken')], tags: [] });
    expect(searchRecipes([z, r], 'chicken').map((x) => x.id)).toEqual(['x', 'z']);
  });
});

describe('quick filters', () => {
  it('quick meals are 30 minutes or less', () => {
    expect(matchesQuickFilter(pasta, 'quick')).toBe(true);
    expect(matchesQuickFilter(chicken, 'quick')).toBe(false);
  });
  it('vegetarian includes vegan', () => {
    expect(all.filter((r) => matchesQuickFilter(r, 'vegetarian')).map((r) => r.id)).toEqual(['p', 'o']);
  });
  it('high protein and favorites', () => {
    expect(all.filter((r) => matchesQuickFilter(r, 'high-protein')).map((r) => r.id)).toEqual(['c']);
    expect(all.filter((r) => matchesQuickFilter(r, 'favorites')).map((r) => r.id)).toEqual(['c']);
  });
});

describe('filterRecipes / sortRecipes / collectTags', () => {
  it('combines filters', () => {
    const r = filterRecipes(all, { query: '', quick: ['vegetarian'], tag: 'dinner', difficulty: null, maxMinutes: 30 });
    expect(r.map((x) => x.id)).toEqual(['p']);
  });
  it('sorts by several keys', () => {
    expect(sortRecipes(all, 'title').map((r) => r.id)).toEqual(['c', 'o', 'p']);
    expect(sortRecipes(all, 'newest').map((r) => r.id)).toEqual(['p', 'c', 'o']);
    expect(sortRecipes(all, 'time').map((r) => r.id)).toEqual(['o', 'p', 'c']);
    expect(sortRecipes(all, 'rating')[0].id).toBe('c');
  });
  it('collects tags by popularity', () => {
    expect(collectTags(all)[0]).toBe('dinner');
    expect(collectTags(all)).toHaveLength(4);
  });
});

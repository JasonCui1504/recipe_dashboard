import { mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { Ingredient, PantryItem, Recipe, RecipeInput } from '../src/shared/schema';

/** All test data lives under <repo>/.test-tmp, never in the real data directory. */
export const TEST_ROOT = resolve(__dirname, '..', '.test-tmp');

export function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = join(TEST_ROOT, `t-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const ing = (quantity: number | null, unit: string, name: string, extra: Partial<Ingredient> = {}): Ingredient => ({
  quantity,
  unit,
  name,
  note: '',
  optional: false,
  staple: false,
  ...extra,
});

export function recipeInput(overrides: Partial<RecipeInput> = {}): RecipeInput {
  return {
    title: 'Test Pancakes',
    description: 'Fluffy fixture pancakes.',
    ingredients: [ing(1, 'cup', 'flour'), ing(2, '', 'eggs'), ing(null, '', 'salt', { staple: true })],
    steps: ['Mix.', 'Cook.'],
    prepMinutes: 5,
    cookMinutes: 10,
    servings: 2,
    difficulty: 'easy',
    tags: ['breakfast'],
    cuisine: '',
    dietary: ['vegetarian'],
    favorite: false,
    rating: null,
    imagePath: null,
    sourceNote: '',
    notes: '',
    nutrition: null,
    ...overrides,
  };
}

export function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    ...recipeInput(),
    id: 'r1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function pantryItem(name: string, overrides: Partial<PantryItem> = {}): PantryItem {
  return {
    id: `p-${name}`,
    name,
    quantity: null,
    unit: '',
    category: '',
    expiresOn: null,
    notes: '',
    usedUp: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

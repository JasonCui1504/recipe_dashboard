import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupSchema } from '../src/shared/backup';
import { LATEST_SCHEMA_VERSION, migrate, openDatabase, schemaVersion } from '../src/server/db';
import { AppError } from '../src/server/errors';
import { SEED_RECIPES } from '../src/server/seed';
import { Store } from '../src/server/store';
import { recipeSchema } from '../src/shared/schema';
import { makeTempDir, recipeInput } from './helpers';

let tmp: ReturnType<typeof makeTempDir>;
let db: DatabaseSync;
let store: Store;
const dbFile = () => join(tmp.dir, 'cookbook.db');

beforeEach(() => {
  tmp = makeTempDir();
  db = openDatabase(dbFile());
  store = new Store(db);
});
afterEach(() => {
  try {
    db.close();
  } catch {
    /* already closed */
  }
  tmp.cleanup();
});

const reopen = () => {
  db.close();
  db = openDatabase(dbFile());
  store = new Store(db);
};

describe('database initialization & migrations', () => {
  it('creates the schema at the latest version', () => {
    expect(schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['recipes', 'pantry_items', 'meals', 'shopping_items', 'settings']));
  });
  it('is idempotent when run again', () => {
    expect(migrate(db)).toEqual({ from: LATEST_SCHEMA_VERSION, to: LATEST_SCHEMA_VERSION });
  });
  it('refuses a database from a newer app version', () => {
    db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow(/newer than this app supports/);
  });
  it('seeds starter recipes exactly once', () => {
    expect(store.seedOnFirstRun()).toBe(true);
    expect(store.listRecipes()).toHaveLength(SEED_RECIPES.length);
    store.deleteRecipe(SEED_RECIPES[0].id);
    reopen();
    expect(store.seedOnFirstRun()).toBe(false);
    expect(store.listRecipes()).toHaveLength(SEED_RECIPES.length - 1);
    expect(store.restoreStarterRecipes()).toBe(1);
    expect(store.restoreStarterRecipes()).toBe(0);
  });
  it('ships valid, internally consistent seed recipes', () => {
    expect(SEED_RECIPES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SEED_RECIPES.map((r) => r.id)).size).toBe(SEED_RECIPES.length);
    for (const seed of SEED_RECIPES) {
      expect(() => recipeSchema.parse({ ...seed, createdAt: 'x', updatedAt: 'x' })).not.toThrow();
      expect(seed.imagePath).toBeNull();
    }
    const poultry = SEED_RECIPES.filter((r) => r.ingredients.some((i) => /chicken/.test(i.name) && !/stock/.test(i.name)));
    for (const r of poultry) expect(r.steps.join(' ')).toMatch(/74°C \/ 165°F/);
  });
});

describe('recipes CRUD', () => {
  it('creates, reads, updates, favorites, duplicates and deletes', () => {
    const created = store.createRecipe(recipeInput());
    expect(created.id).toBeTruthy();
    expect(store.getRecipe(created.id)).toEqual(created);

    const updated = store.updateRecipe(created.id, recipeInput({ title: 'Better Pancakes', notes: 'Add vanilla.' }));
    expect(updated.title).toBe('Better Pancakes');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt >= created.updatedAt).toBe(true);

    expect(store.setFavorite(created.id, true).favorite).toBe(true);

    const copy = store.duplicateRecipe(created.id);
    expect(copy.id).not.toBe(created.id);
    expect(copy.title).toBe('Better Pancakes (copy)');
    expect(copy.favorite).toBe(false);

    store.deleteRecipe(created.id);
    expect(() => store.getRecipe(created.id)).toThrow(AppError);
    expect(store.listRecipes().map((r) => r.id)).toEqual([copy.id]);
  });

  it('rejects invalid input with readable messages', () => {
    try {
      store.createRecipe(recipeInput({ title: '  ', servings: 0, steps: [] }));
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.status).toBe(400);
      expect(e.details.join(' ')).toMatch(/Title is required/);
      expect(e.details.join(' ')).toMatch(/Servings must be at least 1/);
    }
  });

  it('rejects image paths outside the uploads folder', () => {
    expect(() => store.createRecipe(recipeInput({ imagePath: '../../etc/passwd' }))).toThrow(AppError);
    expect(() => store.createRecipe(recipeInput({ imagePath: 'https://example.com/a.png' }))).toThrow(AppError);
    expect(store.createRecipe(recipeInput({ imagePath: `uploads/${'a'.repeat(32)}.png` })).imagePath).toBe(`uploads/${'a'.repeat(32)}.png`);
  });

  it('persists across a restart', () => {
    const created = store.createRecipe(recipeInput({ favorite: true }));
    reopen();
    expect(store.getRecipe(created.id)).toEqual(created);
  });

  it('removes planned meals when a recipe is deleted', () => {
    const r = store.createRecipe(recipeInput());
    store.addMeal({ date: '2026-10-12', slot: 'dinner', recipeId: r.id, servings: 2, note: '' });
    expect(store.deleteRecipe(r.id)).toEqual({ mealsRemoved: 1 });
    expect(store.listMeals('2026-10-01', '2026-10-31')).toEqual([]);
  });
});

describe('pantry', () => {
  it('adds, edits, marks used and removes', () => {
    const item = store.createPantryItem({ name: 'Eggs', quantity: 6, unit: '', category: 'Dairy & Eggs', expiresOn: '2026-11-01', notes: '', usedUp: false });
    const used = store.updatePantryItem(item.id, { ...item, usedUp: true });
    expect(used.usedUp).toBe(true);
    reopen();
    expect(store.listPantry()[0]).toMatchObject({ name: 'Eggs', usedUp: true });
    store.deletePantryItem(item.id);
    expect(store.listPantry()).toEqual([]);
  });
  it('validates expiry dates', () => {
    expect(() => store.createPantryItem({ name: 'Milk', quantity: null, unit: '', category: '', expiresOn: 'tomorrow', notes: '', usedUp: false })).toThrow(AppError);
  });
});

describe('meal plan', () => {
  it('stores meals per date and persists them', () => {
    const r = store.createRecipe(recipeInput());
    const meal = store.addMeal({ date: '2026-10-13', slot: 'Lunch', recipeId: r.id, servings: 3, note: '' });
    expect(meal.slot).toBe('lunch');
    reopen();
    expect(store.listMeals('2026-10-12', '2026-10-18')).toEqual([meal]);
    expect(store.listMeals('2026-10-19', '2026-10-25')).toEqual([]);
    expect(store.updateMealServings(meal.id, 5).servings).toBe(5);
    store.deleteMeal(meal.id);
    expect(store.listMeals('2026-10-12', '2026-10-18')).toEqual([]);
  });
  it('refuses exact duplicates and asks before repeating within a week', () => {
    const r = store.createRecipe(recipeInput());
    store.addMeal({ date: '2026-10-13', slot: 'dinner', recipeId: r.id, servings: 2, note: '' });
    expect(() => store.addMeal({ date: '2026-10-13', slot: 'dinner', recipeId: r.id, servings: 2, note: '' }, true)).toThrow(
      expect.objectContaining({ status: 409, code: 'duplicate' }),
    );
    expect(() => store.addMeal({ date: '2026-10-15', slot: 'dinner', recipeId: r.id, servings: 2, note: '' })).toThrow(
      expect.objectContaining({ status: 409, code: 'repeat' }),
    );
    expect(store.addMeal({ date: '2026-10-15', slot: 'dinner', recipeId: r.id, servings: 2, note: '' }, true).date).toBe('2026-10-15');
    // A different week is not a repeat.
    expect(store.addMeal({ date: '2026-10-20', slot: 'dinner', recipeId: r.id, servings: 2, note: '' }).date).toBe('2026-10-20');
  });
  it('rejects unknown recipes and custom slots are allowed', () => {
    expect(() => store.addMeal({ date: '2026-10-13', slot: 'dinner', recipeId: 'nope', servings: 2, note: '' })).toThrow(expect.objectContaining({ status: 404 }));
    const r = store.createRecipe(recipeInput());
    expect(store.addMeal({ date: '2026-10-13', slot: 'Picnic', recipeId: r.id, servings: 2, note: '' }).slot).toBe('picnic');
  });
});

describe('shopping list', () => {
  it('adds recipe ingredients by name only, merging into what is already listed', () => {
    const r = store.createRecipe(recipeInput());
    store.addManualShopping({ name: 'Flour', quantity: 1, unit: 'cups', category: '' });
    const summary = store.addRecipeToShopping(r.id, 4, true);
    expect(summary).toEqual({ added: 1, merged: 1, skipped: 0 });
    const list = store.listShopping();
    const flour = list.find((i) => i.name === 'Flour')!;
    expect(flour).toMatchObject({ quantity: 1, unit: 'cups' }); // your amount is kept, the recipe's isn't added
    expect(flour.sources.map((s) => s.kind)).toEqual(['manual', 'recipe']);
    expect(list.find((i) => i.name === 'eggs')).toMatchObject({ quantity: null, unit: '' });
    expect(list.some((i) => i.name === 'salt')).toBe(false); // staple skipped
  });

  it('can add only specific ingredients (e.g. missing ones)', () => {
    const r = store.createRecipe(recipeInput());
    store.addRecipeToShopping(r.id, undefined, false, [1]);
    expect(store.listShopping().map((i) => i.name)).toEqual(['eggs']);
  });

  it('adds planned meals once, keeping manual items', () => {
    const r = store.createRecipe(recipeInput());
    store.addManualShopping({ name: 'Coffee', quantity: null, unit: '', category: '' });
    store.addMeal({ date: '2026-10-13', slot: 'breakfast', recipeId: r.id, servings: 4, note: '' });
    const first = store.addMealsToShopping('2026-10-12', '2026-10-18');
    expect(first).toMatchObject({ meals: 1, added: 3 });
    const second = store.addMealsToShopping('2026-10-12', '2026-10-18');
    expect(second).toMatchObject({ meals: 1, added: 0, merged: 0, skipped: 3 });
    const names = store.listShopping().map((i) => i.name);
    expect(names).toContain('Coffee');
    expect(store.listShopping().find((i) => i.name === 'flour')).toMatchObject({ quantity: null, unit: '' });
  });

  it('adds only the ingredients ticked in the grocery-plan review', () => {
    const r = store.createRecipe(recipeInput());
    store.addMeal({ date: '2026-10-20', slot: 'dinner', recipeId: r.id, servings: 2, note: '' });
    const res = store.addMealsToShopping('2026-10-19', '2026-10-25', false, ['egg']);
    expect(res).toMatchObject({ meals: 1, added: 1 });
    expect(store.listShopping().map((i) => i.name)).toEqual(['eggs']);
    // Ticking more later adds just the new ones.
    expect(store.addMealsToShopping('2026-10-19', '2026-10-25', false, ['egg', 'flour'])).toMatchObject({ added: 1, skipped: 1 });
  });

  it('checks off, edits, clears completed and persists', () => {
    store.addManualShopping({ name: 'Lemons', quantity: 2, unit: '', category: '' });
    store.addManualShopping({ name: 'Basil', quantity: 1, unit: 'bunch', category: '' });
    const [lemons] = store.listShopping();
    store.updateShoppingItem(lemons.id, { name: 'Lemons', quantity: 3, unit: '', category: 'Produce', checked: true });
    reopen();
    expect(store.listShopping().find((i) => i.name === 'Lemons')).toMatchObject({ checked: true, quantity: 3 });
    expect(store.clearCheckedShopping()).toBe(1);
    expect(store.listShopping().map((i) => i.name)).toEqual(['Basil']);
  });
});

describe('stores and per-store shopping lists', () => {
  it('creates, renames and refuses duplicate store names', () => {
    const tj = store.createStore({ name: "Trader Joe's" });
    expect(() => store.createStore({ name: "trader joe's" })).toThrow(expect.objectContaining({ status: 409 }));
    expect(store.renameStore(tj.id, { name: 'TJ' })).toEqual({ id: tj.id, name: 'TJ' });
    reopen();
    expect(store.listStores()).toEqual([{ id: tj.id, name: 'TJ' }]);
  });

  it('assigns items to stores and keeps the same ingredient separate per store', () => {
    const costco = store.createStore({ name: 'Costco' });
    store.addManualShopping({ name: 'eggs', quantity: 12, unit: '', category: '', store: costco.id });
    store.addManualShopping({ name: 'eggs', quantity: 6, unit: '', category: '', store: '' });
    const eggs = store.listShopping().filter((i) => i.name === 'eggs');
    expect(eggs.map((i) => [i.store, i.quantity])).toEqual([
      [costco.id, 12],
      ['', 6],
    ]);
  });

  it('remembers where you buy an ingredient and uses it for recipes and meal plans', () => {
    const tj = store.createStore({ name: "Trader Joe's" });
    const r = store.createRecipe(recipeInput());
    // Moving an item to a store teaches the app.
    store.addManualShopping({ name: 'Flour', quantity: 1, unit: 'cup', category: '', store: null });
    const flour = store.listShopping()[0];
    expect(flour.store).toBe('');
    store.updateShoppingItem(flour.id, { ...flour, store: tj.id });
    store.deleteShoppingItem(flour.id);
    store.addRecipeToShopping(r.id);
    const list = store.listShopping();
    expect(list.find((i) => i.name === 'flour')!.store).toBe(tj.id);
    expect(list.find((i) => i.name === 'eggs')!.store).toBe('');
    // "Where I usually buy it" (null) also uses the memory.
    store.addManualShopping({ name: 'FLOUR', quantity: 1, unit: 'cup', category: '', store: null });
    expect(store.listShopping().filter((i) => i.name === 'flour')).toMatchObject([{ quantity: 1, unit: 'cup', store: tj.id }]); // same line, same store
  });

  it('ignores unknown store ids', () => {
    store.addManualShopping({ name: 'milk', quantity: 1, unit: 'l', category: '', store: 'nope' });
    expect(store.listShopping()[0].store).toBe('');
  });

  it('removing a store moves its items to "any store" and forgets it', () => {
    const tj = store.createStore({ name: "Trader Joe's" });
    store.addManualShopping({ name: 'lemons', quantity: 3, unit: '', category: '', store: tj.id });
    expect(store.deleteStore(tj.id)).toEqual({ itemsMoved: 1 });
    expect(store.listShopping()[0].store).toBe('');
    expect(store.storeFor('lemons')).toBe('');
    expect(() => store.deleteStore(tj.id)).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('keeps stores in backups and remaps copied stores on import', () => {
    const tj = store.createStore({ name: "Trader Joe's" });
    store.addManualShopping({ name: 'lemons', quantity: 3, unit: '', category: '', store: tj.id });
    const backup = backupSchema.parse(JSON.parse(JSON.stringify(store.exportAll())));
    expect(backup.data.stores).toEqual([tj]);

    const other = makeTempDir();
    const db2 = openDatabase(join(other.dir, 'cookbook.db'));
    try {
      const s2 = new Store(db2);
      s2.importBackup(backup, 'skip');
      expect(s2.listStores()).toEqual([tj]);
      expect(s2.listShopping()[0].store).toBe(tj.id);
    } finally {
      db2.close();
      other.cleanup();
    }

    // Older backups without stores still import.
    const { stores: _s, ...withoutStores } = backup.data;
    expect(backupSchema.parse({ ...backup, data: withoutStores }).data.stores).toEqual([]);
  });
});

describe('daily messages', () => {
  it('keeps one message per date, newest first, two weeks at most', () => {
    for (let d = 1; d <= 20; d++) store.saveDailyMessage(`2026-10-${String(d).padStart(2, '0')}`, `msg ${d}`);
    store.saveDailyMessage('2026-10-20', 'replaced');
    const all = store.dailyMessages();
    expect(all).toHaveLength(14);
    expect(all[0]).toEqual({ date: '2026-10-20', text: 'replaced' });
    expect(all.filter((m) => m.date === '2026-10-20')).toHaveLength(1);
  });
});

describe('backup export / import', () => {
  function populated() {
    store.seedOnFirstRun();
    const r = store.createRecipe(recipeInput({ title: 'Family Stew' }));
    store.createPantryItem({ name: 'Rice', quantity: 2, unit: 'kg', category: 'Pantry', expiresOn: null, notes: '', usedUp: false });
    store.addMeal({ date: '2026-10-13', slot: 'dinner', recipeId: r.id, servings: 2, note: '' });
    store.addManualShopping({ name: 'Milk', quantity: 1, unit: 'l', category: '' });
    return { r, backup: backupSchema.parse(JSON.parse(JSON.stringify(store.exportAll()))) };
  }

  it('exports a versioned document that validates', () => {
    const { backup } = populated();
    expect(backup.format).toBe('the-cookbook-backup');
    expect(backup.version).toBe(1);
    expect(backup.data.recipes.length).toBe(SEED_RECIPES.length + 1);
  });

  it('round-trips into a clean database', () => {
    const { backup } = populated();
    const other = makeTempDir();
    const db2 = openDatabase(join(other.dir, 'cookbook.db'));
    try {
      const store2 = new Store(db2);
      const preview = store2.previewImport(backup);
      expect(preview.sections.every((s) => s.conflicts.length === 0 && s.identical === 0)).toBe(true);
      const result = store2.importBackup(backup, 'skip');
      expect(result).toMatchObject({ replaced: 0, copied: 0, skipped: 0, warnings: [] });
      expect(store2.exportAll().data).toEqual(backup.data);
    } finally {
      db2.close();
      other.cleanup();
    }
  });

  it('re-importing the same backup changes nothing', () => {
    const { backup } = populated();
    const preview = store.previewImport(backup);
    expect(preview.sections.every((s) => s.new === 0 && s.conflicts.length === 0)).toBe(true);
    const result = store.importBackup(backup, 'replace');
    expect(result.added + result.replaced + result.copied).toBe(0);
  });

  it('never overwrites silently: conflicts are skipped unless asked', () => {
    const { r, backup } = populated();
    store.updateRecipe(r.id, recipeInput({ title: 'Family Stew v2' }));
    const preview = store.previewImport(backup);
    const recipes = preview.sections.find((s) => s.key === 'recipes')!;
    expect(recipes.conflicts).toEqual([{ id: r.id, incoming: 'Family Stew', existing: 'Family Stew v2' }]);

    store.importBackup(backup, 'skip');
    expect(store.getRecipe(r.id).title).toBe('Family Stew v2');

    const copied = store.importBackup(backup, 'copy');
    expect(copied.copied).toBe(1);
    expect(store.listRecipes().some((x) => x.title === 'Family Stew (imported)')).toBe(true);
    expect(store.getRecipe(r.id).title).toBe('Family Stew v2');

    const replaced = store.importBackup(backup, 'replace');
    expect(replaced.replaced).toBe(1);
    expect(store.getRecipe(r.id).title).toBe('Family Stew');
  });

  it('skips meals whose recipe is missing, with a warning', () => {
    const { r, backup } = populated();
    const broken = { ...backup, data: { ...backup.data, recipes: backup.data.recipes.filter((x) => x.id !== r.id) } };
    const other = makeTempDir();
    const db2 = openDatabase(join(other.dir, 'cookbook.db'));
    try {
      const result = new Store(db2).importBackup(broken, 'skip');
      expect(result.warnings).toHaveLength(1);
    } finally {
      db2.close();
      other.cleanup();
    }
  });
});

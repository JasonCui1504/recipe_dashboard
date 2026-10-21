import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type Backup,
  type ConflictStrategy,
  type ImportPreview,
  type ImportResult,
} from '../shared/backup';
import { addDays, startOfWeek } from '../shared/dates';
import { scaleIngredients } from '../shared/quantity';
import {
  aiSettingsSchema,
  DEFAULT_AI_SETTINGS,
  mealInputSchema,
  pantryInputSchema,
  pantryItemSchema,
  recipeInputSchema,
  recipeSchema,
  shoppingInputSchema,
  shoppingItemSchema,
  storeSchema,
  type AiSettings,
  type Meal,
  type MealInput,
  type PantryInput,
  type PantryItem,
  type Recipe,
  type RecipeInput,
  type ShoppingInput,
  type ShoppingItem,
  type Store as GroceryStore,
} from '../shared/schema';
import { normalizeIngredientName } from '../shared/ingredients';
import { planShoppingAddition, type ShoppingAddition } from '../shared/shopping';
import { transaction } from './db';
import { AppError, notFound, parseOrThrow } from './errors';
import { SEED_RECIPES } from './seed';

const now = () => new Date().toISOString();

/** JSON with sorted keys and no `updatedAt`, so equal records compare equal regardless of key order. */
function comparable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([k]) => k !== 'updatedAt')
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return v;
  });
}

interface DataRow {
  id: string;
  data: string;
  created_at: string;
  updated_at: string;
}

interface MealRow {
  id: string;
  date: string;
  slot: string;
  recipe_id: string;
  servings: number;
  note: string;
  created_at: string;
}

const mealFromRow = (r: MealRow): Meal => ({
  id: r.id,
  date: r.date,
  slot: r.slot,
  recipeId: r.recipe_id,
  servings: r.servings,
  note: r.note,
  createdAt: r.created_at,
});

export interface ShoppingAddSummary {
  added: number;
  merged: number;
  skipped: number;
}

/**
 * The data-access layer. All writes validate input with the shared zod
 * schemas, and every read is validated too so a corrupted row surfaces as an
 * error rather than silently breaking the UI.
 */
export class Store {
  constructor(private readonly db: DatabaseSync) {}

  // ---------- recipes ----------

  private recipeFromRow(row: DataRow): Recipe {
    return recipeSchema.parse({
      ...JSON.parse(row.data),
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  listRecipes(): Recipe[] {
    const rows = this.db
      .prepare('SELECT id, data, created_at, updated_at FROM recipes ORDER BY title COLLATE NOCASE')
      .all() as unknown as DataRow[];
    return rows.map((r) => this.recipeFromRow(r));
  }

  getRecipe(id: string): Recipe {
    const row = this.db
      .prepare('SELECT id, data, created_at, updated_at FROM recipes WHERE id = ?')
      .get(id) as DataRow | undefined;
    if (!row) throw notFound('Recipe');
    return this.recipeFromRow(row);
  }

  private hasRecipe(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(id) !== undefined;
  }

  private insertRecipe(recipe: Recipe): void {
    const { id, createdAt, updatedAt, ...input } = recipe;
    this.db
      .prepare('INSERT INTO recipes (id, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, input.title, JSON.stringify(input), createdAt, updatedAt);
  }

  private writeRecipe(recipe: Recipe): void {
    const { id, createdAt: _c, updatedAt, ...input } = recipe;
    this.db
      .prepare('UPDATE recipes SET title = ?, data = ?, updated_at = ? WHERE id = ?')
      .run(input.title, JSON.stringify(input), updatedAt, id);
  }

  createRecipe(raw: unknown): Recipe {
    const input = parseOrThrow(recipeInputSchema, raw, 'recipe');
    const ts = now();
    const recipe: Recipe = { ...input, id: randomUUID(), createdAt: ts, updatedAt: ts };
    this.insertRecipe(recipe);
    return recipe;
  }

  updateRecipe(id: string, raw: unknown): Recipe {
    const existing = this.getRecipe(id);
    const input: RecipeInput = parseOrThrow(recipeInputSchema, raw, 'recipe');
    const recipe: Recipe = { ...input, id, createdAt: existing.createdAt, updatedAt: now() };
    this.writeRecipe(recipe);
    return recipe;
  }

  setFavorite(id: string, favorite: boolean): Recipe {
    const recipe = { ...this.getRecipe(id), favorite, updatedAt: now() };
    this.writeRecipe(recipe);
    return recipe;
  }

  duplicateRecipe(id: string): Recipe {
    const { id: _id, createdAt: _c, updatedAt: _u, ...input } = this.getRecipe(id);
    const title = `${input.title} (copy)`.slice(0, 140);
    return this.createRecipe({ ...input, title, favorite: false });
  }

  /** Deletes a recipe and (via ON DELETE CASCADE) its meal-plan entries. */
  deleteRecipe(id: string): { mealsRemoved: number } {
    return transaction(this.db, () => {
      if (!this.hasRecipe(id)) throw notFound('Recipe');
      const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM meals WHERE recipe_id = ?').get(id) as { n: number };
      this.db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
      return { mealsRemoved: n };
    });
  }

  /** Inserts starter recipes whose IDs are not present. Returns how many were added. */
  restoreStarterRecipes(): number {
    return transaction(this.db, () => {
      let added = 0;
      const ts = now();
      for (const seed of SEED_RECIPES) {
        if (this.hasRecipe(seed.id)) continue;
        this.insertRecipe(recipeSchema.parse({ ...seed, createdAt: ts, updatedAt: ts }));
        added += 1;
      }
      return added;
    });
  }

  /** Seeds starter recipes once, the first time a database is created. */
  seedOnFirstRun(): boolean {
    if (this.getSetting('seeded') !== undefined) return false;
    this.restoreStarterRecipes();
    this.setSetting('seeded', now());
    return true;
  }

  // ---------- pantry ----------

  private pantryFromRow(row: DataRow): PantryItem {
    return pantryItemSchema.parse({ ...JSON.parse(row.data), id: row.id, createdAt: row.created_at, updatedAt: row.updated_at });
  }

  listPantry(): PantryItem[] {
    const rows = this.db.prepare('SELECT id, data, created_at, updated_at FROM pantry_items').all() as unknown as DataRow[];
    return rows.map((r) => this.pantryFromRow(r)).sort((a, b) => a.name.localeCompare(b.name));
  }

  private getPantryItem(id: string): PantryItem {
    const row = this.db.prepare('SELECT id, data, created_at, updated_at FROM pantry_items WHERE id = ?').get(id) as DataRow | undefined;
    if (!row) throw notFound('Pantry item');
    return this.pantryFromRow(row);
  }

  createPantryItem(raw: unknown): PantryItem {
    const input: PantryInput = parseOrThrow(pantryInputSchema, raw, 'pantry item');
    const ts = now();
    const id = randomUUID();
    this.db.prepare('INSERT INTO pantry_items (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, JSON.stringify(input), ts, ts);
    return { ...input, id, createdAt: ts, updatedAt: ts };
  }

  updatePantryItem(id: string, raw: unknown): PantryItem {
    const existing = this.getPantryItem(id);
    const input = parseOrThrow(pantryInputSchema, raw, 'pantry item');
    const ts = now();
    this.db.prepare('UPDATE pantry_items SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(input), ts, id);
    return { ...input, id, createdAt: existing.createdAt, updatedAt: ts };
  }

  deletePantryItem(id: string): void {
    const r = this.db.prepare('DELETE FROM pantry_items WHERE id = ?').run(id);
    if (r.changes === 0) throw notFound('Pantry item');
  }

  // ---------- meal plan ----------

  listMeals(from: string, to: string): Meal[] {
    const rows = this.db
      .prepare('SELECT * FROM meals WHERE date >= ? AND date <= ? ORDER BY date, created_at')
      .all(from, to) as unknown as MealRow[];
    return rows.map(mealFromRow);
  }

  private getMeal(id: string): Meal {
    const row = this.db.prepare('SELECT * FROM meals WHERE id = ?').get(id) as MealRow | undefined;
    if (!row) throw notFound('Planned meal');
    return mealFromRow(row);
  }

  /**
   * Adds a meal. The exact same recipe in the same day+slot is always refused.
   * The same recipe elsewhere in the same week is refused unless `allowRepeat`
   * is set (the UI asks "repeat this meal?" first).
   */
  addMeal(raw: unknown, allowRepeat = false): Meal {
    const input: MealInput = parseOrThrow(mealInputSchema, raw, 'meal');
    const slot = input.slot.toLowerCase();
    if (!this.hasRecipe(input.recipeId)) throw notFound('Recipe');
    const exact = this.db
      .prepare('SELECT 1 FROM meals WHERE date = ? AND slot = ? AND recipe_id = ?')
      .get(input.date, slot, input.recipeId);
    if (exact) {
      throw new AppError(409, 'That recipe is already planned for this meal.', [], 'duplicate');
    }
    if (!allowRepeat) {
      const weekStart = startOfWeek(input.date);
      const repeat = this.db
        .prepare('SELECT date FROM meals WHERE recipe_id = ? AND date >= ? AND date <= ? LIMIT 1')
        .get(input.recipeId, weekStart, addDays(weekStart, 6)) as { date: string } | undefined;
      if (repeat) {
        throw new AppError(409, `This recipe is already planned on ${repeat.date} this week.`, [], 'repeat');
      }
    }
    const meal: Meal = { ...input, slot, id: randomUUID(), createdAt: now() };
    this.db
      .prepare('INSERT INTO meals (id, date, slot, recipe_id, servings, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(meal.id, meal.date, meal.slot, meal.recipeId, meal.servings, meal.note, meal.createdAt);
    return meal;
  }

  updateMealServings(id: string, servings: unknown): Meal {
    const meal = this.getMeal(id);
    const parsed = parseOrThrow(mealInputSchema.shape.servings, servings, 'servings');
    this.db.prepare('UPDATE meals SET servings = ? WHERE id = ?').run(parsed, id);
    return { ...meal, servings: parsed };
  }

  deleteMeal(id: string): void {
    const r = this.db.prepare('DELETE FROM meals WHERE id = ?').run(id);
    if (r.changes === 0) throw notFound('Planned meal');
  }

  // ---------- shopping list ----------

  private shoppingFromRow(row: DataRow): ShoppingItem {
    return shoppingItemSchema.parse({ ...JSON.parse(row.data), id: row.id, createdAt: row.created_at, updatedAt: row.updated_at });
  }

  listShopping(): ShoppingItem[] {
    const rows = this.db
      .prepare('SELECT id, data, created_at, updated_at FROM shopping_items ORDER BY created_at, rowid')
      .all() as unknown as DataRow[];
    return rows.map((r) => this.shoppingFromRow(r));
  }

  private getShoppingItem(id: string): ShoppingItem {
    const row = this.db.prepare('SELECT id, data, created_at, updated_at FROM shopping_items WHERE id = ?').get(id) as DataRow | undefined;
    if (!row) throw notFound('Shopping item');
    return this.shoppingFromRow(row);
  }

  private writeShopping(item: ShoppingItem, insert: boolean): void {
    const { id, createdAt, updatedAt, ...data } = item;
    if (insert) {
      this.db.prepare('INSERT INTO shopping_items (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, JSON.stringify(data), createdAt, updatedAt);
    } else {
      this.db.prepare('UPDATE shopping_items SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), updatedAt, id);
    }
  }

  /** Adds items using the conservative merge rules in shared/shopping.ts. */
  addShopping(additions: ShoppingAddition[]): ShoppingAddSummary {
    return transaction(this.db, () => {
      const summary: ShoppingAddSummary = { added: 0, merged: 0, skipped: 0 };
      for (const addition of additions) {
        // No store given: use the store this ingredient was last assigned to.
        const add = addition.store === undefined ? { ...addition, store: this.storeFor(addition.name) } : addition;
        const existing = this.listShopping();
        const plan = planShoppingAddition(existing, add);
        const ts = now();
        if (plan.action === 'skip') {
          summary.skipped += 1;
        } else if (plan.action === 'merge') {
          const target = existing.find((i) => i.id === plan.targetId)!;
          this.writeShopping({ ...target, quantity: plan.quantity, unit: plan.unit, sources: plan.sources, updatedAt: ts }, false);
          summary.merged += 1;
        } else {
          this.writeShopping({ ...plan.item, id: randomUUID(), createdAt: ts, updatedAt: ts }, true);
          summary.added += 1;
        }
      }
      return summary;
    });
  }

  /**
   * Adds an item typed in by the user. `store: null` means "where I usually buy
   * it" (the remembered store); a store id or '' (any store) is used as given,
   * and a chosen store is remembered for next time.
   */
  addManualShopping(raw: unknown): ShoppingAddSummary {
    const input = parseOrThrow(
      shoppingInputSchema.omit({ checked: true, store: true }).extend({ store: z.string().max(64).nullable().default(null) }),
      raw,
      'shopping item',
    );
    const store = input.store === null ? undefined : this.validStore(input.store);
    if (store) this.rememberStore(input.name, store);
    return this.addShopping([
      { ...input, store, source: { kind: 'manual', recipeId: null, mealId: null, label: 'Added by you' } },
    ]);
  }

  /** Adds a recipe's (scaled) ingredients; `onlyIndexes` limits it to specific ingredients. */
  addRecipeToShopping(recipeId: string, servings?: number, skipStaples = false, onlyIndexes?: number[]): ShoppingAddSummary {
    const recipe = this.getRecipe(recipeId);
    const target = servings ?? recipe.servings;
    const scaled = scaleIngredients(recipe.ingredients, recipe.servings, target);
    if (!scaled.ok) throw new AppError(400, scaled.error);
    return this.addShopping(
      scaled.ingredients
        .filter((i, idx) => !(skipStaples && i.staple) && (!onlyIndexes || onlyIndexes.includes(idx)))
        .map((i) => ({
          name: i.name,
          // Only the ingredient goes on the list, not the recipe's amount.
          quantity: null,
          unit: '',
          source: { kind: 'recipe', recipeId: recipe.id, mealId: null, label: recipe.title },
        })),
    );
  }

  /** Adds ingredients for every planned meal in [from, to]; meals already added are skipped. */
  /**
   * `onlyKeys` (normalized ingredient names, from the grocery-plan review)
   * limits which ingredients are added; anything the user unticked is left out.
   */
  addMealsToShopping(from: string, to: string, skipStaples = false, onlyKeys?: string[]): ShoppingAddSummary & { meals: number } {
    const meals = this.listMeals(from, to);
    const allowed = onlyKeys ? new Set(onlyKeys) : null;
    const total: ShoppingAddSummary & { meals: number } = { added: 0, merged: 0, skipped: 0, meals: meals.length };
    for (const meal of meals) {
      const recipe = this.getRecipe(meal.recipeId);
      const scaled = scaleIngredients(recipe.ingredients, recipe.servings, meal.servings);
      if (!scaled.ok) continue;
      const r = this.addShopping(
        scaled.ingredients
          .filter((i) => !(skipStaples && i.staple) && (!allowed || allowed.has(normalizeIngredientName(i.name))))
          .map((i) => ({
            name: i.name,
            quantity: null,
            unit: '',
            source: { kind: 'meal', recipeId: recipe.id, mealId: meal.id, label: `${recipe.title} · ${meal.date} ${meal.slot}` },
          })),
      );
      total.added += r.added;
      total.merged += r.merged;
      total.skipped += r.skipped;
    }
    return total;
  }

  updateShoppingItem(id: string, raw: unknown): ShoppingItem {
    const existing = this.getShoppingItem(id);
    const parsed: ShoppingInput = parseOrThrow(shoppingInputSchema, raw, 'shopping item');
    const input = { ...parsed, store: this.validStore(parsed.store) };
    if (input.store !== (existing.store ?? '')) this.rememberStore(input.name, input.store);
    const item = { ...existing, ...input, updatedAt: now() };
    this.writeShopping(item, false);
    return item;
  }

  deleteShoppingItem(id: string): void {
    const r = this.db.prepare('DELETE FROM shopping_items WHERE id = ?').run(id);
    if (r.changes === 0) throw notFound('Shopping item');
  }

  clearCheckedShopping(): number {
    return transaction(this.db, () => {
      const checked = this.listShopping().filter((i) => i.checked);
      for (const item of checked) this.db.prepare('DELETE FROM shopping_items WHERE id = ?').run(item.id);
      return checked.length;
    });
  }

  // ---------- settings ----------

  private getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  private setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  /**
   * Saved AI settings, or the defaults (AI off). COOKBOOK_OLLAMA_URL lets the
   * installer point the default at a different local Ollama, e.g. the finance
   * dashboard's model server on 127.0.0.1:11435.
   */
  getAiSettings(): AiSettings {
    const defaults = { ...DEFAULT_AI_SETTINGS, baseUrl: process.env.COOKBOOK_OLLAMA_URL || DEFAULT_AI_SETTINGS.baseUrl };
    const raw = this.getSetting('ai');
    if (!raw) return defaults;
    const parsed = aiSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaults;
  }

  setAiSettings(raw: unknown): AiSettings {
    const settings = parseOrThrow(aiSettingsSchema, raw, 'AI settings');
    this.setSetting('ai', JSON.stringify(settings));
    return settings;
  }

  // ---------- daily message ----------

  /** Saved daily messages, newest first (kept for two weeks). */
  dailyMessages(): Array<{ date: string; text: string }> {
    const raw = this.getSetting('dailyMessages');
    const parsed = raw ? z.array(z.object({ date: z.string(), text: z.string() })).safeParse(JSON.parse(raw)) : null;
    return parsed?.success ? parsed.data : [];
  }

  saveDailyMessage(date: string, text: string): void {
    const rest = this.dailyMessages().filter((m) => m.date !== date);
    this.setSetting('dailyMessages', JSON.stringify([{ date, text }, ...rest].slice(0, 14)));
  }

  // ---------- stores ----------

  listStores(): GroceryStore[] {
    const raw = this.getSetting('stores');
    if (!raw) return [];
    const parsed = z.array(storeSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  }

  private saveStores(stores: GroceryStore[]): void {
    this.setSetting('stores', JSON.stringify(stores));
  }

  createStore(raw: unknown): GroceryStore {
    const { name } = parseOrThrow(storeSchema.pick({ name: true }), raw, 'store');
    const stores = this.listStores();
    if (stores.some((st) => st.name.toLowerCase() === name.toLowerCase())) {
      throw new AppError(409, `You already have a store called “${name}”.`, [], 'duplicate');
    }
    if (stores.length >= 50) throw new AppError(400, 'That’s a lot of stores — remove one first.');
    const store = { id: randomUUID(), name };
    this.saveStores([...stores, store]);
    return store;
  }

  renameStore(id: string, raw: unknown): GroceryStore {
    const { name } = parseOrThrow(storeSchema.pick({ name: true }), raw, 'store');
    const stores = this.listStores();
    if (!stores.some((st) => st.id === id)) throw notFound('Store');
    if (stores.some((st) => st.id !== id && st.name.toLowerCase() === name.toLowerCase())) {
      throw new AppError(409, `You already have a store called “${name}”.`, [], 'duplicate');
    }
    this.saveStores(stores.map((st) => (st.id === id ? { ...st, name } : st)));
    return { id, name };
  }

  /** Removes a store; its items move to "any store" and remembered choices are forgotten. */
  deleteStore(id: string): { itemsMoved: number } {
    return transaction(this.db, () => {
      const stores = this.listStores();
      if (!stores.some((st) => st.id === id)) throw notFound('Store');
      this.saveStores(stores.filter((st) => st.id !== id));
      let itemsMoved = 0;
      for (const item of this.listShopping()) {
        if (item.store === id) {
          this.writeShopping({ ...item, store: '', updatedAt: now() }, false);
          itemsMoved += 1;
        }
      }
      const memory = this.storeMemory();
      for (const [k, v] of Object.entries(memory)) if (v === id) delete memory[k];
      this.setSetting('storeMemory', JSON.stringify(memory));
      return { itemsMoved };
    });
  }

  /** A known store id, or '' for anything else. */
  private validStore(id: string): string {
    return id && this.listStores().some((st) => st.id === id) ? id : '';
  }

  private storeMemory(): Record<string, string> {
    const raw = this.getSetting('storeMemory');
    const parsed = raw ? z.record(z.string()).safeParse(JSON.parse(raw)) : null;
    return parsed?.success ? parsed.data : {};
  }

  /** Remembers which store an ingredient is bought at ('' forgets it). */
  private rememberStore(name: string, storeId: string): void {
    const key = normalizeIngredientName(name);
    if (!key) return;
    const memory = this.storeMemory();
    if (storeId) memory[key] = storeId;
    else delete memory[key];
    this.setSetting('storeMemory', JSON.stringify(memory));
  }

  /** The store this ingredient was last assigned to, if that store still exists. */
  storeFor(name: string): string {
    return this.validStore(this.storeMemory()[normalizeIngredientName(name)] ?? '');
  }

  // ---------- backup ----------

  exportAll(): Backup {
    const mealRows = this.db.prepare('SELECT * FROM meals ORDER BY date, created_at').all() as unknown as MealRow[];
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now(),
      data: {
        recipes: this.listRecipes(),
        pantry: this.listPantry(),
        mealPlan: mealRows.map(mealFromRow),
        shopping: this.listShopping(),
        stores: this.listStores(),
      },
    };
  }

  private existingById(): Record<keyof Backup['data'], Map<string, { label: string; json: string }>> {
    const strip = comparable;
    const all = this.exportAll().data;
    return {
      recipes: new Map(all.recipes.map((r) => [r.id, { label: r.title, json: strip(r) }])),
      pantry: new Map(all.pantry.map((p) => [p.id, { label: p.name, json: strip(p) }])),
      mealPlan: new Map(all.mealPlan.map((m) => [m.id, { label: `${m.date} ${m.slot}`, json: strip(m) }])),
      shopping: new Map(all.shopping.map((s) => [s.id, { label: s.name, json: strip(s) }])),
      stores: new Map(all.stores.map((s) => [s.id, { label: s.name, json: strip(s) }])),
    };
  }

  previewImport(backup: Backup): ImportPreview {
    const existing = this.existingById();
    const labels = { recipes: 'Recipes', pantry: 'Pantry items', mealPlan: 'Planned meals', shopping: 'Shopping items', stores: 'Stores' } as const;
    const labelOf = (key: keyof Backup['data'], x: Record<string, unknown>) =>
      String(key === 'recipes' ? x.title : key === 'mealPlan' ? `${x.date} ${x.slot}` : x.name);
    const sections = (Object.keys(labels) as Array<keyof Backup['data']>).map((key) => {
      const rows = backup.data[key] as unknown as Array<Record<string, unknown> & { id: string }>;
      let fresh = 0;
      let identical = 0;
      const conflicts: ImportPreview['sections'][number]['conflicts'] = [];
      for (const row of rows) {
        const have = existing[key].get(row.id);
        if (!have) fresh += 1;
        else {
          if (comparable(row) === have.json) identical += 1;
          else conflicts.push({ id: row.id, incoming: labelOf(key, row), existing: have.label });
        }
      }
      return { key, label: labels[key], total: rows.length, new: fresh, identical, conflicts };
    });
    return { exportedAt: backup.exportedAt, sections };
  }

  /**
   * Imports a validated backup in one transaction. New IDs are inserted as-is;
   * identical records are skipped; differing records with an existing ID follow
   * `strategy` (default "skip" — nothing you have is ever overwritten silently).
   */
  importBackup(backup: Backup, strategy: ConflictStrategy): ImportResult {
    const preview = this.previewImport(backup);
    const conflictIds = new Map(preview.sections.map((s) => [s.key, new Set(s.conflicts.map((c) => c.id))]));
    const result: ImportResult = { added: 0, replaced: 0, copied: 0, skipped: 0, warnings: [] };
    const recipeIdMap = new Map<string, string>();

    return transaction(this.db, () => {
      const existing = this.existingById();
      const decide = (key: keyof Backup['data'], id: string): 'insert' | 'skip' | 'replace' | 'copy' => {
        if (!existing[key].has(id)) return 'insert';
        if (!conflictIds.get(key)!.has(id)) return 'skip'; // identical
        return strategy === 'skip' ? 'skip' : strategy;
      };

      for (const recipe of backup.data.recipes) {
        const d = decide('recipes', recipe.id);
        if (d === 'insert') {
          this.insertRecipe(recipe);
          result.added += 1;
        } else if (d === 'replace') {
          this.writeRecipe(recipe);
          result.replaced += 1;
        } else if (d === 'copy') {
          const id = randomUUID();
          recipeIdMap.set(recipe.id, id);
          this.insertRecipe({ ...recipe, id, title: `${recipe.title} (imported)`.slice(0, 140) });
          result.copied += 1;
        } else result.skipped += 1;
      }

      const simple = (key: 'pantry' | 'shopping', table: string, items: Array<PantryItem | ShoppingItem>) => {
        for (const item of items) {
          const { id, createdAt, updatedAt, ...data } = item;
          const d = decide(key, id);
          if (d === 'insert' || d === 'copy') {
            const newId = d === 'copy' ? randomUUID() : id;
            this.db.prepare(`INSERT INTO ${table} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(newId, JSON.stringify(data), createdAt, updatedAt);
            if (d === 'insert') result.added += 1;
            else result.copied += 1;
          } else if (d === 'replace') {
            this.db.prepare(`UPDATE ${table} SET data = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(data), updatedAt, id);
            result.replaced += 1;
          } else result.skipped += 1;
        }
      };
      // Stores before shopping items, so copied stores can be remapped.
      const storeIdMap = new Map<string, string>();
      let stores = this.listStores();
      for (const store of backup.data.stores) {
        const d = decide('stores', store.id);
        const nameTaken = (name: string, exceptId?: string) =>
          stores.some((st) => st.id !== exceptId && st.name.toLowerCase() === name.toLowerCase());
        if (d === 'insert' && !nameTaken(store.name)) {
          stores = [...stores, store];
          result.added += 1;
        } else if (d === 'insert') {
          // Same name, different id: reuse the store you already have.
          storeIdMap.set(store.id, stores.find((st) => st.name.toLowerCase() === store.name.toLowerCase())!.id);
          result.skipped += 1;
        } else if (d === 'replace' && !nameTaken(store.name, store.id)) {
          stores = stores.map((st) => (st.id === store.id ? store : st));
          result.replaced += 1;
        } else if (d === 'copy') {
          const copy = { id: randomUUID(), name: `${store.name} (imported)`.slice(0, 40) };
          storeIdMap.set(store.id, copy.id);
          stores = [...stores, copy];
          result.copied += 1;
        } else result.skipped += 1;
      }
      this.saveStores(stores);

      simple('pantry', 'pantry_items', backup.data.pantry);
      simple(
        'shopping',
        'shopping_items',
        backup.data.shopping.map((item) => ({ ...item, store: storeIdMap.get(item.store) ?? item.store })),
      );

      for (const meal of backup.data.mealPlan) {
        const recipeId = recipeIdMap.get(meal.recipeId) ?? meal.recipeId;
        if (!this.hasRecipe(recipeId)) {
          result.warnings.push(`Skipped a meal on ${meal.date}: its recipe is not in the backup or your library.`);
          result.skipped += 1;
          continue;
        }
        let d = decide('mealPlan', meal.id);
        const dup = this.db
          .prepare('SELECT 1 FROM meals WHERE date = ? AND slot = ? AND recipe_id = ? AND id != ?')
          .get(meal.date, meal.slot, recipeId, meal.id);
        if (dup && d !== 'replace') d = 'skip';
        if (d === 'insert' || d === 'copy') {
          const id = d === 'copy' ? randomUUID() : meal.id;
          this.db
            .prepare('INSERT INTO meals (id, date, slot, recipe_id, servings, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(id, meal.date, meal.slot, recipeId, meal.servings, meal.note, meal.createdAt);
          if (d === 'insert') result.added += 1;
          else result.copied += 1;
        } else if (d === 'replace') {
          this.db
            .prepare('UPDATE meals SET date = ?, slot = ?, recipe_id = ?, servings = ?, note = ? WHERE id = ?')
            .run(meal.date, meal.slot, recipeId, meal.servings, meal.note, meal.id);
          result.replaced += 1;
        } else result.skipped += 1;
      }
      return result;
    });
  }
}

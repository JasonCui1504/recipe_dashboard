import { z } from 'zod';

/**
 * Data model shared by the server (validation at the API/database boundary)
 * and the client (types + form validation).
 */

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

/** Local images only: either an uploaded file in the app's data dir, or none. */
export const IMAGE_PATH_PATTERN = /^uploads\/[a-f0-9]{32}\.(png|jpg|webp)$/;

const trimmed = (max: number) => z.string().trim().max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');

export const ingredientSchema = z.object({
  quantity: z.number().finite().nonnegative().nullable(),
  unit: trimmed(30),
  name: trimmed(120).min(1, 'Ingredient name is required'),
  note: trimmed(200),
  optional: z.boolean(),
  staple: z.boolean(),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

export const nutritionSchema = z.object({
  calories: z.number().nonnegative().nullable(),
  protein: z.number().nonnegative().nullable(),
  carbs: z.number().nonnegative().nullable(),
  fat: z.number().nonnegative().nullable(),
  basis: z.enum(['user-entered', 'estimated']),
});
export type Nutrition = z.infer<typeof nutritionSchema>;

/** Fields the user edits. Everything except id/timestamps. */
export const recipeInputSchema = z.object({
  title: trimmed(140).min(1, 'Title is required'),
  description: trimmed(600),
  ingredients: z.array(ingredientSchema).min(1, 'Add at least one ingredient').max(100),
  steps: z
    .array(trimmed(2000).min(1, 'Steps cannot be empty'))
    .min(1, 'Add at least one step')
    .max(60),
  prepMinutes: z.number().int().min(0).max(2880),
  cookMinutes: z.number().int().min(0).max(2880),
  servings: z.number().int().min(1, 'Servings must be at least 1').max(100),
  difficulty: z.enum(DIFFICULTIES),
  tags: z.array(trimmed(40).min(1)).max(20),
  cuisine: trimmed(60),
  dietary: z.array(trimmed(40).min(1)).max(10),
  favorite: z.boolean(),
  rating: z.number().int().min(1).max(5).nullable(),
  imagePath: z
    .string()
    .regex(IMAGE_PATH_PATTERN, 'Images must be uploaded through the app')
    .nullable(),
  sourceNote: trimmed(300),
  notes: trimmed(4000),
  nutrition: nutritionSchema.nullable(),
});
export type RecipeInput = z.infer<typeof recipeInputSchema>;

export const recipeSchema = recipeInputSchema.extend({
  id: z.string().min(1).max(64),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Recipe = z.infer<typeof recipeSchema>;

export const pantryInputSchema = z.object({
  name: trimmed(120).min(1, 'Name is required'),
  quantity: z.number().finite().nonnegative().nullable(),
  unit: trimmed(30),
  category: trimmed(40),
  expiresOn: isoDate.nullable(),
  notes: trimmed(500),
  usedUp: z.boolean(),
});
export type PantryInput = z.infer<typeof pantryInputSchema>;
export const pantryItemSchema = pantryInputSchema.extend({
  id: z.string().min(1).max(64),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PantryItem = z.infer<typeof pantryItemSchema>;

export const mealInputSchema = z.object({
  date: isoDate,
  slot: trimmed(30).min(1),
  recipeId: z.string().min(1).max(64),
  servings: z.number().int().min(1).max(100),
  note: trimmed(200),
});
export type MealInput = z.infer<typeof mealInputSchema>;
export const mealSchema = mealInputSchema.extend({
  id: z.string().min(1).max(64),
  createdAt: z.string(),
});
export type Meal = z.infer<typeof mealSchema>;

export const shoppingSourceSchema = z.object({
  kind: z.enum(['manual', 'recipe', 'meal']),
  recipeId: z.string().nullable(),
  label: z.string().max(200),
  mealId: z.string().nullable(),
});
export type ShoppingSource = z.infer<typeof shoppingSourceSchema>;

export const shoppingInputSchema = z.object({
  name: trimmed(120).min(1, 'Name is required'),
  quantity: z.number().finite().nonnegative().nullable(),
  unit: trimmed(30),
  category: trimmed(40),
  checked: z.boolean(),
});
export type ShoppingInput = z.infer<typeof shoppingInputSchema>;
export const shoppingItemSchema = shoppingInputSchema.extend({
  id: z.string().min(1).max(64),
  sources: z.array(shoppingSourceSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ShoppingItem = z.infer<typeof shoppingItemSchema>;

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().trim().max(200),
  model: z.string().trim().min(1).max(100),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'llama3.1:8b',
};

export function emptyRecipeInput(): RecipeInput {
  return {
    title: '',
    description: '',
    ingredients: [{ quantity: null, unit: '', name: '', note: '', optional: false, staple: false }],
    steps: [''],
    prepMinutes: 10,
    cookMinutes: 20,
    servings: 2,
    difficulty: 'easy',
    tags: [],
    cuisine: '',
    dietary: [],
    favorite: false,
    rating: null,
    imagePath: null,
    sourceNote: '',
    notes: '',
    nutrition: null,
  };
}

const FIELD_LABELS: Record<string, string> = {
  prepMinutes: 'Prep time',
  cookMinutes: 'Cook time',
  expiresOn: 'Expiry date',
  imagePath: 'Photo',
  sourceNote: 'Source',
  recipeId: 'Recipe',
};

function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Turns a zod error into a short list of readable messages, e.g. "Ingredients › 2 › Name: …". */
export function describeZodError(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.map((p) => (typeof p === 'number' ? String(p + 1) : fieldLabel(p))).join(' › ');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

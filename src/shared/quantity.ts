import type { Ingredient } from './schema';

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

/**
 * Parses a user-typed quantity such as "2", "1.5", "1/2", "1 1/2" or "1½".
 * Returns null for blank or unparseable input (e.g. "a pinch", "2-3").
 */
export function parseQuantity(input: string): number | null {
  let text = input.trim().replace(',', '.');
  if (!text) return null;
  for (const [glyph, value] of Object.entries(UNICODE_FRACTIONS)) {
    if (text.includes(glyph)) {
      const rest = text.replace(glyph, '').trim();
      const whole = rest ? Number(rest) : 0;
      if (!Number.isFinite(whole)) return null;
      return round(whole + value, 4);
    }
  }
  text = text.replace(/\s+/g, ' ');
  const mixed = /^(\d+) (\d+)\/(\d+)$/.exec(text);
  if (mixed) {
    const d = Number(mixed[3]);
    if (d === 0) return null;
    return round(Number(mixed[1]) + Number(mixed[2]) / d, 4);
  }
  const frac = /^(\d+)\/(\d+)$/.exec(text);
  if (frac) {
    const d = Number(frac[2]);
    if (d === 0) return null;
    return round(Number(frac[1]) / d, 4);
  }
  if (/^\d*\.?\d+$/.test(text)) return Number(text);
  return null;
}

const NICE_FRACTIONS: Array<[number, string]> = [
  [1 / 8, '1/8'],
  [1 / 4, '1/4'],
  [1 / 3, '1/3'],
  [3 / 8, '3/8'],
  [1 / 2, '1/2'],
  [5 / 8, '5/8'],
  [2 / 3, '2/3'],
  [3 / 4, '3/4'],
  [7 / 8, '7/8'],
];

/**
 * Formats a quantity for display. Values close to a common kitchen fraction
 * are shown as fractions ("1 1/2"); others as decimals with at most 2 places.
 * Large values (>= 20) are shown as whole-ish decimals since "21 1/3 g" is silly.
 */
export function formatQuantity(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  if (value < 0) return '';
  if (value >= 20) return String(round(value, 1));
  const whole = Math.floor(value + 1e-9);
  const fraction = value - whole;
  if (fraction < 0.01) return String(whole);
  if (fraction > 0.99) return String(whole + 1);
  for (const [v, label] of NICE_FRACTIONS) {
    if (Math.abs(fraction - v) < 0.01) return whole ? `${whole} ${label}` : label;
  }
  return String(round(value, 2));
}

export function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export type ScaleResult =
  | { ok: true; factor: number; ingredients: Ingredient[] }
  | { ok: false; error: string };

/**
 * Scales ingredient quantities from the recipe's original servings to a
 * target serving count. Returns new objects; the input is never mutated.
 * Ingredients with no numeric quantity ("salt, to taste") are left as-is.
 */
export function scaleIngredients(
  ingredients: readonly Ingredient[],
  originalServings: number,
  targetServings: number,
): ScaleResult {
  if (!Number.isFinite(originalServings) || originalServings <= 0) {
    return { ok: false, error: 'The recipe has no valid serving count to scale from.' };
  }
  if (!Number.isFinite(targetServings) || targetServings <= 0) {
    return { ok: false, error: 'Servings must be a number greater than zero.' };
  }
  const factor = targetServings / originalServings;
  return {
    ok: true,
    factor,
    ingredients: ingredients.map((ing) => ({
      ...ing,
      quantity: ing.quantity === null ? null : round(ing.quantity * factor, 3),
    })),
  };
}

/** "1 1/2 cups rice, rinsed" style one-line description. */
export function describeIngredient(ing: Pick<Ingredient, 'quantity' | 'unit' | 'name' | 'note'>): string {
  const parts = [formatQuantity(ing.quantity), ing.unit, ing.name].filter(Boolean).join(' ');
  return ing.note ? `${parts}, ${ing.note}` : parts;
}

import { normalizeUnit } from './ingredients';
import { round } from './quantity';

/**
 * Unit conversion within one kind of measure: weight (g, kg, oz, lb) or
 * volume (tsp, tbsp, cup, ml, l, fl oz, pint, quart, gallon). Volume and
 * weight are never converted into each other — that depends on the
 * ingredient (a cup of flour and a cup of honey weigh very different amounts).
 * US customary measures are used for cups, pints and fluid ounces.
 */

type Dimension = 'mass' | 'volume';

const UNITS: Record<string, { dim: Dimension; base: number }> = {
  // grams
  g: { dim: 'mass', base: 1 },
  kg: { dim: 'mass', base: 1000 },
  oz: { dim: 'mass', base: 28.349523125 },
  lb: { dim: 'mass', base: 453.59237 },
  // millilitres
  ml: { dim: 'volume', base: 1 },
  l: { dim: 'volume', base: 1000 },
  tsp: { dim: 'volume', base: 4.92892159375 },
  tbsp: { dim: 'volume', base: 14.78676478125 },
  'fl oz': { dim: 'volume', base: 29.5735295625 },
  cup: { dim: 'volume', base: 236.5882365 },
  pint: { dim: 'volume', base: 473.176473 },
  quart: { dim: 'volume', base: 946.352946 },
  gallon: { dim: 'volume', base: 3785.411784 },
};

const EXTRA_ALIASES: Record<string, string> = {
  'fl. oz': 'fl oz',
  'fl oz': 'fl oz',
  floz: 'fl oz',
  'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz',
  pints: 'pint',
  pt: 'pint',
  quarts: 'quart',
  qt: 'quart',
  gallons: 'gallon',
  gal: 'gallon',
};

/** Canonical convertible unit, or null when the unit isn't a weight/volume ("clove", "can", ""). */
export function convertibleUnit(unit: string): string | null {
  const raw = unit.trim().toLowerCase().replace(/\s+/g, ' ');
  const key = EXTRA_ALIASES[raw] ?? normalizeUnit(unit);
  return key in UNITS ? key : null;
}

export function sameDimension(a: string, b: string): boolean {
  const ua = convertibleUnit(a);
  const ub = convertibleUnit(b);
  return ua !== null && ub !== null && UNITS[ua].dim === UNITS[ub].dim;
}

/** Converts `quantity` from one unit to another of the same kind, or returns null. */
export function convertQuantity(quantity: number, from: string, to: string): number | null {
  const a = convertibleUnit(from);
  const b = convertibleUnit(to);
  if (!a || !b || UNITS[a].dim !== UNITS[b].dim) return null;
  return (quantity * UNITS[a].base) / UNITS[b].base;
}

/**
 * Adds two amounts if it's safe to: identical units (after normalization), or
 * units of the same kind. The result is expressed in the larger of the two units,
 * keeping the spelling used for that unit ("1 cup + 2 tbsp" → "1 1/8 cup").
 */
export function addQuantities(
  a: { quantity: number; unit: string },
  b: { quantity: number; unit: string },
): { quantity: number; unit: string } | null {
  if (normalizeUnit(a.unit) === normalizeUnit(b.unit)) {
    return { quantity: round(a.quantity + b.quantity, 3), unit: a.unit };
  }
  const ua = convertibleUnit(a.unit);
  const ub = convertibleUnit(b.unit);
  if (!ua || !ub || UNITS[ua].dim !== UNITS[ub].dim) return null;
  const larger = UNITS[ua].base >= UNITS[ub].base ? a : b;
  const total = (a.quantity * UNITS[ua].base + b.quantity * UNITS[ub].base) / UNITS[convertibleUnit(larger.unit)!].base;
  return { quantity: round(total, 3), unit: larger.unit };
}

/** Whether two ingredient lines could be combined (both blank, identical, or same kind of measure). */
export function canCombineUnits(a: string, b: string): boolean {
  return normalizeUnit(a) === normalizeUnit(b) || sameDimension(a, b);
}

// ---------------------------------------------------------------------------
// Display systems for the recipe page
// ---------------------------------------------------------------------------

export type UnitSystem = 'original' | 'metric' | 'us';

function niceMetric(value: number): number {
  if (value < 10) return round(value, 1);
  if (value < 100) return Math.round(value);
  return Math.round(value / 5) * 5;
}

/**
 * Re-expresses an amount in metric or US units for display. Spoon measures
 * stay as spoons in metric (they're used everywhere); anything that isn't a
 * weight or volume is returned unchanged. `converted` is true when the value
 * was changed, so the UI can mark it as approximate.
 */
export function toSystem(
  quantity: number | null,
  unit: string,
  system: UnitSystem,
): { quantity: number | null; unit: string; converted: boolean } {
  const same = { quantity, unit, converted: false };
  if (system === 'original' || quantity === null) return same;
  const u = convertibleUnit(unit);
  if (!u) return same;
  const { dim } = UNITS[u];
  const grams = quantity * UNITS[u].base;

  if (system === 'metric') {
    if (u === 'g' || u === 'kg' || u === 'ml' || u === 'l' || u === 'tsp' || u === 'tbsp') return same;
    if (dim === 'mass') return grams >= 1000 ? { quantity: round(grams / 1000, 2), unit: 'kg', converted: true } : { quantity: niceMetric(grams), unit: 'g', converted: true };
    return grams >= 1000 ? { quantity: round(grams / 1000, 2), unit: 'l', converted: true } : { quantity: niceMetric(grams), unit: 'ml', converted: true };
  }

  // US customary
  if (dim === 'mass') {
    if (u === 'oz' || u === 'lb') return same;
    const oz = grams / UNITS.oz.base;
    if (oz >= 16) return { quantity: round(Math.round((oz / 16) * 4) / 4, 2), unit: 'lb', converted: true };
    return { quantity: Math.max(0.25, Math.round(oz * 4) / 4), unit: 'oz', converted: true };
  }
  if (u === 'tsp' || u === 'tbsp' || u === 'cup' || u === 'fl oz' || u === 'pint' || u === 'quart' || u === 'gallon') return same;
  const ml = grams;
  if (ml >= UNITS.cup.base / 4) return { quantity: round(Math.round((ml / UNITS.cup.base) * 8) / 8, 3), unit: 'cup', converted: true };
  if (ml >= UNITS.tbsp.base) return { quantity: round(Math.round((ml / UNITS.tbsp.base) * 2) / 2, 2), unit: 'tbsp', converted: true };
  return { quantity: round(Math.round((ml / UNITS.tsp.base) * 4) / 4, 2), unit: 'tsp', converted: true };
}

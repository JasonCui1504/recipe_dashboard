import { normalizeUnit } from './ingredients';
import { parseQuantity } from './quantity';
import type { Ingredient } from './schema';

const KNOWN_UNITS = new Set(['tsp', 'tbsp', 'cup', 'g', 'kg', 'ml', 'l', 'oz', 'lb', 'clove', 'can', 'slice', 'pinch', 'bunch', 'piece']);

/**
 * Parses a pasted ingredient line like "1 1/2 cups rice, rinsed" into a
 * structured ingredient. Anything it can't confidently read stays in the name.
 */
export function parseIngredientLine(line: string): Ingredient | null {
  let text = line.trim().replace(/^[-*•]\s*/, '');
  if (!text) return null;

  let quantity: number | null = null;
  const qtyMatch = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+\s*[½⅓⅔¼¾⅛]?|[½⅓⅔¼¾⅛])(\s+|$)/.exec(text);
  if (qtyMatch) {
    const q = parseQuantity(qtyMatch[1]);
    if (q !== null) {
      quantity = q;
      text = text.slice(qtyMatch[0].length);
    }
  }

  let unit = '';
  const unitMatch = /^([A-Za-z]+\.?)\s+/.exec(text);
  if (quantity !== null && unitMatch && KNOWN_UNITS.has(normalizeUnit(unitMatch[1]))) {
    unit = unitMatch[1].replace(/\.$/, '');
    text = text.slice(unitMatch[0].length);
  }

  let note = '';
  const comma = text.indexOf(',');
  if (comma > 0) {
    note = text.slice(comma + 1).trim();
    text = text.slice(0, comma);
  }
  let optional = false;
  if (/\(optional\)/i.test(text) || /^optional$/i.test(note)) {
    optional = true;
    text = text.replace(/\(optional\)/i, '');
    if (/^optional$/i.test(note)) note = '';
  }
  const name = text.trim();
  if (!name) return null;
  return { quantity, unit, name: name.slice(0, 120), note: note.slice(0, 200), optional, staple: false };
}

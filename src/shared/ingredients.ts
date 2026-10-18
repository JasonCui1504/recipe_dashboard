/**
 * Conservative ingredient-name normalization and unit handling.
 *
 * Matching rules are intentionally strict and transparent:
 *  - case, surrounding/duplicate whitespace and punctuation are ignored;
 *  - simple English plurals are folded ("tomatoes" → "tomato");
 *  - a small explicit alias map maps common synonyms ("scallion" → "green onion").
 * Nothing else is fuzzy: "salt" never matches "garlic salt", "oil" never matches
 * "olive oil".
 */

export const INGREDIENT_ALIASES: Readonly<Record<string, string>> = {
  scallion: 'green onion',
  'spring onion': 'green onion',
  'garbanzo bean': 'chickpea',
  'garbanzo': 'chickpea',
  'coriander leaf': 'cilantro',
  'fresh coriander': 'cilantro',
  'courgette': 'zucchini',
  'aubergine': 'eggplant',
  'capsicum': 'bell pepper',
  'bicarbonate of soda': 'baking soda',
  'caster sugar': 'superfine sugar',
  'icing sugar': 'powdered sugar',
  'confectioners sugar': 'powdered sugar',
  'plain flour': 'all-purpose flour',
  'all purpose flour': 'all-purpose flour',
  'prawn': 'shrimp',
  'rocket': 'arugula',
  'chilli flake': 'red pepper flake',
  'chili flake': 'red pepper flake',
  'crushed red pepper': 'red pepper flake',
};

/** Words that end in "s" but are not plurals (or whose singular is awkward). */
const NO_SINGULAR = new Set([
  'asparagus',
  'couscous',
  'hummus',
  'molasses',
  'swiss',
  'grits',
  'greens',
  'brussels',
  'harissa',
  'quinoa',
]);

function singularize(word: string): string {
  if (word.length <= 3 || NO_SINGULAR.has(word) || word.endsWith('ss') || word.endsWith('us')) {
    return word;
  }
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(tomato|potato|mango|chilli|chili)es$/.test(word)) return word.slice(0, -2);
  if (/(ch|sh|x)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Normalizes an ingredient name to its canonical comparison key. */
export function normalizeIngredientName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(' ');
  const last = words.length - 1;
  words[last] = singularize(words[last]);
  const key = words.join(' ');
  return INGREDIENT_ALIASES[key] ?? key;
}

const UNIT_ALIASES: Readonly<Record<string, string>> = {
  t: 'tsp',
  tsp: 'tsp',
  tsps: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  T: 'tbsp',
  tbsp: 'tbsp',
  tbsps: 'tbsp',
  tbs: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  c: 'cup',
  cup: 'cup',
  cups: 'cup',
  g: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  l: 'l',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  clove: 'clove',
  cloves: 'clove',
  can: 'can',
  cans: 'can',
  slice: 'slice',
  slices: 'slice',
  pinch: 'pinch',
  pinches: 'pinch',
  bunch: 'bunch',
  bunches: 'bunch',
  piece: 'piece',
  pieces: 'piece',
  pc: 'piece',
  pcs: 'piece',
};

/** Normalizes a unit for comparison. Unknown units are lower-cased and kept. */
export function normalizeUnit(unit: string): string {
  const trimmed = unit.trim().replace(/\.$/, '');
  if (!trimmed) return '';
  if (trimmed === 'T') return 'tbsp';
  return UNIT_ALIASES[trimmed.toLowerCase()] ?? trimmed.toLowerCase();
}

/**
 * Two quantities can be safely combined only when both are numeric and their
 * units are identical after normalization (including both having no unit).
 * No conversions are attempted — 1 cup and 200 g of rice stay separate.
 */
export function unitsCompatible(a: string, b: string): boolean {
  return normalizeUnit(a) === normalizeUnit(b);
}

/** Rough grocery-aisle category for grouping a shopping list. */
const CATEGORY_KEYWORDS: Array<[string, string[]]> = [
  ['Produce', ['onion', 'garlic', 'tomato', 'spinach', 'pepper', 'carrot', 'celery', 'lemon', 'lime', 'avocado', 'potato', 'zucchini', 'broccoli', 'cucumber', 'lettuce', 'cilantro', 'parsley', 'basil', 'ginger', 'mushroom', 'banana', 'berry', 'berries', 'apple', 'kale', 'cabbage', 'sweet potato', 'herb', 'scallion', 'green onion', 'edamame', 'pea', 'chili', 'mint']],
  ['Meat & Fish', ['chicken', 'beef', 'pork', 'salmon', 'fish', 'shrimp', 'turkey', 'bacon', 'sausage', 'tuna', 'lamb']],
  ['Dairy & Eggs', ['milk', 'butter', 'cheese', 'yogurt', 'yoghurt', 'cream', 'egg', 'parmesan', 'feta']],
  ['Bakery', ['bread', 'tortilla', 'bun', 'pita', 'sourdough']],
  ['Spices & Condiments', ['salt', 'cumin', 'paprika', 'turmeric', 'garam masala', 'cinnamon', 'soy sauce', 'vinegar', 'mustard', 'honey', 'maple', 'sauce', 'flake', 'oregano', 'thyme', 'curry', 'sesame oil', 'chia', 'black pepper', 'red pepper flake', 'chili powder']],
  ['Pantry', ['crushed tomato', 'diced tomato', 'tomato paste', 'rice', 'pasta', 'flour', 'sugar', 'oil', 'oat', 'lentil', 'chickpea', 'bean', 'stock', 'broth', 'quinoa', 'coconut milk', 'canned', 'noodle', 'tahini', 'nut', 'seed']],
];

export function guessCategory(name: string): string {
  const key = normalizeIngredientName(name);
  // Prefer the longest matching keyword so "sesame oil" beats "oil".
  let best: { category: string; length: number } | null = null;
  for (const [category, words] of CATEGORY_KEYWORDS) {
    for (const word of words) {
      const re = new RegExp(`(^|\\s)${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`);
      if (re.test(key) && (!best || word.length > best.length)) {
        best = { category, length: word.length };
      }
    }
  }
  return best?.category ?? 'Other';
}

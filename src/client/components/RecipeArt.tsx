import type { Recipe } from '../../shared/schema';
import { api } from '../api';

/**
 * Original, bundled SVG illustrations used whenever a recipe has no photo.
 * The motif is chosen from the recipe's tags/title; colors are derived from
 * its ID so cards look varied but stable.
 */

type Motif = 'bowl' | 'pan' | 'pot' | 'plate' | 'toast' | 'jar' | 'pasta';

const PALETTES = [
  { bg: '#ece6d6', a: '#7d9474', b: '#c98b5a', c: '#e7c873' },
  { bg: '#e8e9dc', a: '#a35d45', b: '#7d9474', c: '#f0d9a7' },
  { bg: '#efe4d3', a: '#5f7b6a', b: '#d39b64', c: '#b9c9a6' },
  { bg: '#e6e4d8', a: '#b27150', b: '#94a97f', c: '#f3e2b5' },
  { bg: '#f0e8da', a: '#6c8a74', b: '#c7684f', c: '#e9cf8f' },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function pickMotif(recipe: Pick<Recipe, 'title' | 'tags'>): Motif {
  const text = `${recipe.title} ${recipe.tags.join(' ')}`.toLowerCase();
  if (/pasta|spaghetti|noodle|penne/.test(text)) return 'pasta';
  if (/soup|stew|curry|chili/.test(text)) return 'pot';
  if (/toast|sandwich|bread/.test(text)) return 'toast';
  if (/oats|jar|smoothie|make-ahead/.test(text)) return 'jar';
  if (/omelet|egg|fried rice|stir-fry|skillet/.test(text)) return 'pan';
  if (/bowl|rice|salad|grain/.test(text)) return 'bowl';
  return 'plate';
}

function Motifs({ motif, p }: { motif: Motif; p: (typeof PALETTES)[number] }) {
  const ink = '#2f3130';
  switch (motif) {
    case 'bowl':
      return (
        <g>
          <ellipse cx="100" cy="78" rx="52" ry="12" fill={p.c} />
          <circle cx="80" cy="74" r="9" fill={p.a} />
          <circle cx="104" cy="70" r="8" fill={p.b} />
          <circle cx="122" cy="76" r="7" fill={p.a} opacity=".8" />
          <path d="M46 80h108a54 40 0 0 1-108 0z" fill="#faf7f0" stroke={ink} strokeWidth="2.5" />
          <path d="M70 100c12 6 48 6 60 0" stroke={p.a} strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'pan':
      return (
        <g>
          <path d="M150 86h38" stroke={ink} strokeWidth="6" strokeLinecap="round" />
          <ellipse cx="96" cy="86" rx="56" ry="30" fill="#faf7f0" stroke={ink} strokeWidth="2.5" />
          <ellipse cx="96" cy="84" rx="44" ry="21" fill={p.c} />
          <circle cx="82" cy="80" r="9" fill="#fff8e8" />
          <circle cx="82" cy="80" r="4.5" fill={p.b} />
          <circle cx="108" cy="90" r="5" fill={p.a} />
          <circle cx="114" cy="76" r="4" fill={p.a} />
        </g>
      );
    case 'pot':
      return (
        <g>
          <path d="M80 34c0-8 8-8 8-16M100 34c0-8 8-8 8-16M120 34c0-8 8-8 8-16" stroke={p.a} strokeWidth="3" fill="none" strokeLinecap="round" />
          <rect x="52" y="52" width="96" height="60" rx="14" fill="#faf7f0" stroke={ink} strokeWidth="2.5" />
          <path d="M52 66h96" stroke={ink} strokeWidth="2.5" />
          <path d="M40 62h12M148 62h12" stroke={ink} strokeWidth="5" strokeLinecap="round" />
          <ellipse cx="100" cy="58" rx="40" ry="5" fill={p.b} />
          <path d="M70 90c10-6 50-6 60 0" stroke={p.a} strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'toast':
      return (
        <g>
          <ellipse cx="100" cy="104" rx="70" ry="10" fill="#faf7f0" stroke={ink} strokeWidth="2" />
          <path d="M60 98V58a20 18 0 0 1 14-20h52a20 18 0 0 1 14 20v40z" fill={p.c} stroke={ink} strokeWidth="2.5" />
          <path d="M70 70c10-10 50-10 60 0v10H70z" fill={p.a} />
          <ellipse cx="100" cy="68" rx="12" ry="9" fill="#fff8e8" />
          <circle cx="100" cy="68" r="5" fill={p.b} />
        </g>
      );
    case 'jar':
      return (
        <g>
          <rect x="74" y="28" width="52" height="12" rx="3" fill={p.a} />
          <rect x="68" y="40" width="64" height="74" rx="12" fill="#faf7f0" stroke={ink} strokeWidth="2.5" />
          <path d="M70 78h60v24a10 10 0 0 1-10 10H80a10 10 0 0 1-10-10z" fill={p.c} />
          <circle cx="86" cy="62" r="6" fill={p.b} />
          <circle cx="104" cy="58" r="5" fill={p.b} opacity=".85" />
          <circle cx="116" cy="66" r="5.5" fill={p.a} />
        </g>
      );
    case 'pasta':
      return (
        <g>
          <ellipse cx="100" cy="84" rx="66" ry="26" fill="#faf7f0" stroke={ink} strokeWidth="2.5" />
          <ellipse cx="100" cy="80" rx="42" ry="15" fill={p.c} />
          <path d="M70 80c8-10 20 6 30-4s22 6 30-4M74 86c10-6 18 4 28-2s18 4 26-2" stroke="#d7b46a" strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="96" cy="74" r="6" fill={p.b} />
          <path d="M116 70l6-4M80 72l-5-4" stroke={p.a} strokeWidth="4" strokeLinecap="round" />
        </g>
      );
    default:
      return (
        <g>
          <ellipse cx="100" cy="82" rx="64" ry="28" fill="#faf7f0" stroke={ink} strokeWidth="2.5" />
          <ellipse cx="100" cy="82" rx="46" ry="18" fill="none" stroke={ink} strokeOpacity=".2" strokeWidth="2" />
          <ellipse cx="90" cy="80" rx="22" ry="10" fill={p.b} />
          <path d="M112 76c6-6 14-4 18 0-6 4-12 6-18 0z" fill={p.a} />
          <path d="M114 88c6-4 12-2 14 2-6 2-10 2-14-2z" fill={p.a} opacity=".75" />
        </g>
      );
  }
}

export function RecipeArt({
  recipe,
  className = '',
}: {
  recipe: Pick<Recipe, 'id' | 'title' | 'tags' | 'imagePath'>;
  className?: string;
}) {
  if (recipe.imagePath) {
    return <img className={`recipe-art ${className}`} src={api.images.url(recipe.imagePath)} alt="" loading="lazy" />;
  }
  const p = PALETTES[hash(recipe.id) % PALETTES.length];
  return (
    <svg className={`recipe-art ${className}`} viewBox="0 0 200 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect width="200" height="130" fill={p.bg} />
      <circle cx="170" cy="22" r="30" fill={p.c} opacity=".35" />
      <circle cx="22" cy="118" r="26" fill={p.a} opacity=".18" />
      <Motifs motif={pickMotif(recipe)} p={p} />
    </svg>
  );
}

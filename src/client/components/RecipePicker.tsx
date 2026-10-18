import { useId, useMemo, useRef, useState } from 'react';
import type { Recipe } from '../../shared/schema';
import { searchRecipes, totalMinutes } from '../../shared/search';
import { useRecipes } from '../state';
import { formatMinutes } from './common';
import { IconHeart, IconSearch } from './Icons';

const MAX_RESULTS = 8;

/**
 * Type-to-search recipe picker (an accessible combobox). Matches titles,
 * ingredients and tags; with an empty box it shows favorites first. Arrow
 * keys move through the results, Enter picks, Escape closes.
 */
export function RecipePicker({
  onSelect,
  label,
  placeholder = 'Search recipes…',
  compact = false,
  alignRight = false,
  disabled = false,
  autoFocus = false,
}: {
  onSelect: (recipe: Recipe) => void;
  /** Accessible name for the search box. */
  label: string;
  placeholder?: string;
  compact?: boolean;
  /** Open the results to the left (for pickers near the right edge). */
  alignRight?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const { recipes } = useRecipes();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const list = query.trim()
      ? searchRecipes(recipes, query)
      : [...recipes].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title));
    return list.slice(0, MAX_RESULTS);
  }, [recipes, query]);

  const choose = (recipe: Recipe) => {
    onSelect(recipe);
    setQuery('');
    setOpen(false);
    setActive(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && results[active]) {
        e.preventDefault();
        choose(results[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation(); // don't also close a surrounding dialog
        setOpen(false);
      }
    }
  };

  const showList = open && !disabled;

  return (
    <div className={`picker ${compact ? 'picker-compact' : ''}`}>
      <div className="picker-field">
        <IconSearch size={compact ? 14 : 16} className="picker-icon" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </div>
      {showList && (
        <ul id={listId} role="listbox" aria-label={`${label} results`} className={`picker-list ${alignRight ? 'picker-right' : ''}`}>
          {results.length === 0 ? (
            <li className="picker-empty" role="presentation">
              {recipes.length === 0 ? 'No recipes yet' : `No recipes match “${query.trim()}”`}
            </li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`picker-option ${i === active ? 'is-active' : ''}`}
                // mousedown (not click) so the input's blur doesn't close the list first
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(r);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="picker-title">
                  {r.favorite && <IconHeart filled size={12} className="picker-fav" />}
                  {r.title}
                </span>
                <span className="picker-meta">{formatMinutes(totalMinutes(r))}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

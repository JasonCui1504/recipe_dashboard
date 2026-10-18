import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DIFFICULTIES } from '../../shared/schema';
import { collectTags, filterRecipes, QUICK_FILTERS, sortRecipes, type QuickFilter, type SortKey } from '../../shared/search';
import { capitalize, EmptyState, ErrorState, Loading, PageHeader, RecipeCard } from '../components/common';
import { IconPlus, IconSpark } from '../components/Icons';
import { useDocumentTitle, useRecipes } from '../state';

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: 'title', label: 'Title (A–Z)' },
  { id: 'newest', label: 'Newest first' },
  { id: 'updated', label: 'Recently edited' },
  { id: 'time', label: 'Quickest first' },
  { id: 'rating', label: 'Highest rated' },
];

export function Library() {
  useDocumentTitle('My Recipes');
  const { recipes, loading, error, reload } = useRecipes();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const tag = params.get('tag');
  const difficulty = params.get('difficulty') as (typeof DIFFICULTIES)[number] | null;
  const maxMinutes = params.get('max') ? Number(params.get('max')) : null;
  const sort = (params.get('sort') as SortKey | null) ?? 'title';
  const quick = (params.get('f')?.split(',').filter(Boolean) ?? []) as QuickFilter[];

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const toggleQuick = (f: QuickFilter) => set('f', (quick.includes(f) ? quick.filter((x) => x !== f) : [...quick, f]).join(','));

  const tags = useMemo(() => collectTags(recipes), [recipes]);
  const shown = useMemo(
    () => sortRecipes(filterRecipes(recipes, { query, quick, tag, difficulty, maxMinutes }), sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recipes, query, quick.join(), tag, difficulty, maxMinutes, sort],
  );
  const anyFilter = query || tag || difficulty || maxMinutes !== null || quick.length > 0;

  return (
    <div className="page">
      <PageHeader title="My Recipes" kicker={`${recipes.length} recipe${recipes.length === 1 ? '' : 's'} in your cookbook`}>
        <Link to="/recipes/new?ai=1" className="btn btn-ghost">
          <IconSpark size={18} /> Draft with AI
        </Link>
        <Link to="/recipes/new" className="btn btn-primary">
          <IconPlus size={18} /> New recipe
        </Link>
      </PageHeader>

      <section className="toolbar" aria-label="Filter and sort">
        <label className="field field-grow">
          <span className="label">Search</span>
          <input type="search" value={query} placeholder="Title, ingredient, tag…" onChange={(e) => set('q', e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Category</span>
          <select value={tag ?? ''} onChange={(e) => set('tag', e.target.value || null)}>
            <option value="">All</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Difficulty</span>
          <select value={difficulty ?? ''} onChange={(e) => set('difficulty', e.target.value || null)}>
            <option value="">Any</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {capitalize(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Total time</span>
          <select value={maxMinutes ?? ''} onChange={(e) => set('max', e.target.value || null)}>
            <option value="">Any</option>
            <option value="15">15 min or less</option>
            <option value="30">30 min or less</option>
            <option value="45">45 min or less</option>
            <option value="60">1 hour or less</option>
          </select>
        </label>
        <label className="field">
          <span className="label">Sort by</span>
          <select value={sort} onChange={(e) => set('sort', e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </section>
      <div className="chips" role="group" aria-label="Quick filters">
        {QUICK_FILTERS.map((f) => (
          <button key={f.id} type="button" className="chip" aria-pressed={quick.includes(f.id)} title={f.description} onClick={() => toggleQuick(f.id)}>
            {f.label}
          </button>
        ))}
        {anyFilter && (
          <button type="button" className="btn btn-link" onClick={() => setParams(new URLSearchParams(sort !== 'title' ? { sort } : {}), { replace: true })}>
            Clear filters
          </button>
        )}
      </div>

      {loading && recipes.length === 0 ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : recipes.length === 0 ? (
        <EmptyState title="No recipes yet">
          <p>Start your cookbook with a family favorite.</p>
          <Link to="/recipes/new" className="btn btn-primary">
            <IconPlus size={18} /> Add a recipe
          </Link>
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title="No recipes match these filters">
          <p>Try removing a filter or searching for something else.</p>
        </EmptyState>
      ) : (
        <>
          <p className="muted" aria-live="polite">
            Showing {shown.length} of {recipes.length}
          </p>
          <div className="card-grid">
            {shown.map((r) => (
              <RecipeCard key={r.id} recipe={r} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, formatWeekRange, startOfWeek, toIsoDate } from '../../shared/dates';
import { defaultShoppingWeekOffset } from '../../shared/planning';
import { matchRecipes } from '../../shared/matching';
import { collectTags, filterRecipes, matchesQuickFilter, QUICK_FILTERS, type QuickFilter } from '../../shared/search';
import { api, errorMessage } from '../api';
import { EmptyState, ErrorState, Loading, RecipeCard } from '../components/common';
import { IconCart, IconLeaf, IconPlus, IconSearch, IconSpark } from '../components/Icons';
import { KitchenBuddy } from '../components/KitchenBuddy';
import { WeekMenu } from '../components/WeekMenu';
import { useDocumentTitle, useLoader, useRecipes, useToast } from '../state';

function dayOfYear(): number {
  const now = new Date();
  return Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000);
}

export function Discover() {
  useDocumentTitle('Discover');
  const { recipes, loading, error, reload } = useRecipes();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const active = (params.get('f')?.split(',').filter(Boolean) ?? []) as Array<QuickFilter | 'pantry'>;
  const usePantry = active.includes('pantry');
  const quick = active.filter((f): f is QuickFilter => f !== 'pantry');
  const pantry = useLoader(() => (usePantry ? api.pantry.list() : Promise.resolve(null)), [usePantry]);
  const toast = useToast();
  const [restoring, setRestoring] = useState(false);
  // From Friday on, the menu shows next week — that's the one you're shopping for.
  const [weekOffset, setWeekOffset] = useState<0 | 1>(() => defaultShoppingWeekOffset(new Date()));
  const thisWeek = startOfWeek(toIsoDate(new Date()));
  const menuWeek = addDays(thisWeek, weekOffset * 7);

  const ai = useLoader(() => api.ai.settings(), []);
  const aiOn = ai.data?.enabled === true;
  const [llama, setLlama] = useState<{
    query: string;
    loading: boolean;
    error: string | null;
    picks: Array<{ recipeId: string; reason: string }>;
    note: string;
  } | null>(null);

  const askLlama = async () => {
    const q = query.trim();
    if (!q) return;
    setLlama({ query: q, loading: true, error: null, picks: [], note: '' });
    try {
      const r = await api.ai.recommend(q);
      setLlama((cur) => (cur?.query === q ? { query: q, loading: false, error: null, picks: r.recommendations, note: r.note } : cur));
    } catch (err) {
      setLlama((cur) => (cur?.query === q ? { query: q, loading: false, error: errorMessage(err), picks: [], note: '' } : cur));
    }
  };

  const update = (q: string, filters: string[]) => {
    if (q.trim() !== query.trim()) setLlama(null);
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (filters.length) next.set('f', filters.join(','));
    setParams(next, { replace: true });
  };
  const toggle = (f: QuickFilter | 'pantry') =>
    update(query, active.includes(f) ? active.filter((x) => x !== f) : [...active, f]);

  const filtering = query.trim() !== '' || active.length > 0;
  const results = useMemo(
    () => filterRecipes(recipes, { query, quick, tag: null, difficulty: null, maxMinutes: null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recipes, query, quick.join()],
  );
  const pantryMatches = useMemo(() => {
    if (!usePantry || !pantry.data) return null;
    return matchRecipes(results, pantry.data, { countOptional: false, assumeStaples: true, today: toIsoDate(new Date()) }).filter(
      (m) => m.verdict !== 'not-yet',
    );
  }, [usePantry, pantry.data, results]);

  const favorites = recipes.filter((r) => r.favorite).slice(0, 4);
  const recent = [...recipes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  const quickPicks = useMemo(() => {
    const q = recipes.filter((r) => matchesQuickFilter(r, 'quick'));
    if (q.length === 0) return [];
    const start = dayOfYear() % q.length;
    return [...q.slice(start), ...q.slice(0, start)].slice(0, 4);
  }, [recipes]);
  const tags = collectTags(recipes).slice(0, 10);

  const restore = async () => {
    setRestoring(true);
    try {
      const { added } = await api.recipes.restoreStarters();
      await reload();
      toast(`Added ${added} starter recipe${added === 1 ? '' : 's'}.`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="page discover">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-main">
        <p className="kicker">Your kitchen companion</p>
        <h1 id="hero-title" className="hero-title">
          What sounds good?
        </h1>
        <form
          className={`search ${aiOn ? 'has-ai' : ''}`}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (aiOn) void askLlama();
          }}
        >
          <label htmlFor="discover-search" className="visually-hidden">
            Search recipes
          </label>
          <IconSearch className="search-icon" />
          <input
            id="discover-search"
            type="search"
            placeholder="Search by recipe, ingredient or tag…"
            value={query}
            onChange={(e) => update(e.target.value, active)}
            autoComplete="off"
          />
          {aiOn && (
            <button type="submit" className="btn btn-primary search-ai" disabled={!query.trim() || llama?.loading} aria-label="Ask Llama">
              <IconSpark size={16} />{' '}
              {llama?.loading ? (
                'Thinking…'
              ) : (
                <>
                  Ask<span className="hide-narrow"> Llama</span>
                </>
              )}
            </button>
          )}
        </form>
        {aiOn ? (
          <p className="hint search-hint">Type to search instantly, or describe what you feel like and press Ask Llama (Enter) to have your local model pick from your recipes.</p>
        ) : (
          query.trim().split(/\s+/).length >= 3 && (
            <p className="hint search-hint">
              Want your local Llama to pick from your recipes for requests like this? Turn on AI in <Link to="/settings">Settings</Link>.
            </p>
          )
        )}
        <div className="chips" role="group" aria-label="Quick filters">
          {QUICK_FILTERS.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={active.includes(f.id)} title={f.description} onClick={() => toggle(f.id)}>
              {f.label}
            </button>
          ))}
          <button type="button" className="chip" aria-pressed={usePantry} title="Recipes you can make (or nearly make) from your pantry" onClick={() => toggle('pantry')}>
            <IconLeaf size={16} /> Use My Pantry
          </button>
        </div>
        </div>
        <KitchenBuddy />
      </section>

      {loading && recipes.length === 0 ? (
        <Loading label="Loading your recipes…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : recipes.length === 0 ? (
        <EmptyState title="Your cookbook is empty">
          <p>Add your first recipe, or bring back the starter recipes to explore the app.</p>
          <div className="button-row">
            <Link to="/recipes/new" className="btn btn-primary">
              <IconPlus size={18} /> Add your first recipe
            </Link>
            <button type="button" className="btn btn-ghost" onClick={restore} disabled={restoring}>
              Restore starter recipes
            </button>
          </div>
        </EmptyState>
      ) : filtering ? (
        <section aria-labelledby="results-title" className="section">
          {llama && (
            <div className="llama-results" aria-live="polite">
              <h2 className="section-title small-title">
                <IconSpark size={18} /> Llama’s picks for “{llama.query}”
              </h2>
              {llama.loading ? (
                <Loading label="Asking your local model… (this can take a few seconds)" />
              ) : llama.error ? (
                <div className="state state-error" role="alert">
                  <p>{llama.error}</p>
                  <p className="small">The regular search results are below.</p>
                </div>
              ) : (
                <>
                  <p className="ai-label">
                    <IconSpark size={16} /> Suggestions from your local Llama, chosen only from your own recipes. Reasons are its opinion, not verified.
                  </p>
                  {llama.picks.length === 0 ? (
                    <p className="muted">{llama.note || 'Llama didn’t find a good match in your recipes.'}</p>
                  ) : (
                    <div className="card-grid">
                      {llama.picks.map((p) => {
                        const r = recipes.find((x) => x.id === p.recipeId);
                        return r ? <RecipeCard key={r.id} recipe={r} extra={p.reason ? <p className="llama-reason">{p.reason}</p> : null} /> : null;
                      })}
                    </div>
                  )}
                  {llama.picks.length > 0 && llama.note && <p className="muted small">{llama.note}</p>}
                </>
              )}
            </div>
          )}
          <div className="section-head">
            <h2 id="results-title" className="section-title">
              {usePantry ? 'From your pantry' : 'Results'}
            </h2>
            <button type="button" className="btn btn-link" onClick={() => update('', [])}>
              Clear search
            </button>
          </div>
          {usePantry && pantry.loading ? (
            <Loading label="Checking your pantry…" />
          ) : usePantry && pantry.error ? (
            <ErrorState message={pantry.error} onRetry={pantry.reload} />
          ) : usePantry && pantryMatches ? (
            pantryMatches.length === 0 ? (
              <EmptyState title="Nothing matches your pantry yet">
                <p>
                  Add what you have on the <Link to="/pantry">Pantry</Link> page — matching assumes you have staples like salt and oil.
                </p>
              </EmptyState>
            ) : (
              <div className="card-grid" aria-live="polite">
                {pantryMatches.map((m) => (
                  <RecipeCard
                    key={m.recipe.id}
                    recipe={m.recipe}
                    extra={<p className={`match-note match-${m.verdict}`}>{m.verdict === 'ready' ? 'You have everything' : m.summary}</p>}
                  />
                ))}
              </div>
            )
          ) : results.length === 0 ? (
            <EmptyState title="No recipes found">
              <p>Try fewer words or remove a filter.</p>
            </EmptyState>
          ) : (
            <>
              <p className="muted" aria-live="polite">
                {results.length} recipe{results.length === 1 ? '' : 's'}
              </p>
              <div className="card-grid">
                {results.map((r) => (
                  <RecipeCard key={r.id} recipe={r} />
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        <>
          <section className="section menu-section" aria-labelledby="menu-title">
            <div className="section-head">
              <div>
                <h2 id="menu-title" className="section-title">
                  {weekOffset === 0 ? 'This week’s menu' : 'Next week’s menu'}
                </h2>
                <p className="section-note">{formatWeekRange(menuWeek)} · choose a lunch and dinner for each day</p>
              </div>
              <div className="button-row">
                <div className="segmented" role="group" aria-label="Which week">
                  <button type="button" aria-pressed={weekOffset === 0} onClick={() => setWeekOffset(0)}>
                    This week
                  </button>
                  <button type="button" aria-pressed={weekOffset === 1} onClick={() => setWeekOffset(1)}>
                    Next week
                  </button>
                </div>
                <Link className="btn btn-primary" to={`/shopping/plan?week=${menuWeek}`}>
                  <IconCart size={18} /> Groceries for this menu
                </Link>
              </div>
            </div>
            <WeekMenu weekStart={menuWeek} />
            <p className="muted small">
              Need breakfast, custom meals or different servings? Open the full <Link to={`/planner?week=${menuWeek}`}>Meal Planner</Link>.
            </p>
          </section>
          {tags.length > 0 && (
            <section className="section" aria-labelledby="cat-title">
              <h2 id="cat-title" className="section-title">
                Browse by category
              </h2>
              <ul className="category-row">
                {tags.map((t) => (
                  <li key={t}>
                    <Link className="category" to={`/recipes?tag=${encodeURIComponent(t)}`}>
                      {t}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {favorites.length > 0 && (
            <section className="section" aria-labelledby="fav-title">
              <div className="section-head">
                <h2 id="fav-title" className="section-title">
                  Your favorites
                </h2>
                <button type="button" className="btn btn-link" onClick={() => toggle('favorites')}>
                  See all
                </button>
              </div>
              <div className="card-grid">
                {favorites.map((r) => (
                  <RecipeCard key={r.id} recipe={r} />
                ))}
              </div>
            </section>
          )}
          {quickPicks.length > 0 && (
            <section className="section" aria-labelledby="quick-title">
              <div className="section-head">
                <h2 id="quick-title" className="section-title">
                  Quick tonight
                </h2>
                <p className="section-note">Ready in 30 minutes or less</p>
              </div>
              <div className="card-grid">
                {quickPicks.map((r) => (
                  <RecipeCard key={r.id} recipe={r} />
                ))}
              </div>
            </section>
          )}
          <section className="section" aria-labelledby="recent-title">
            <div className="section-head">
              <h2 id="recent-title" className="section-title">
                Recently added
              </h2>
              <Link to="/recipes?sort=newest" className="btn btn-link">
                All recipes
              </Link>
            </div>
            <div className="card-grid">
              {recent.map((r) => (
                <RecipeCard key={r.id} recipe={r} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

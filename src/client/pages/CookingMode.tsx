import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { describeIngredient, scaleIngredients } from '../../shared/quantity';
import { EmptyState, ErrorState, Loading } from '../components/common';
import { IconChevronLeft, IconChevronRight, IconClose } from '../components/Icons';
import { useDocumentTitle, useRecipes } from '../state';

/** Ticked ingredients survive re-renders and reloads for this tab only. */
function useSessionSet(key: string) {
  const [set, setSet] = useState<Set<number>>(() => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(key) ?? '[]') as number[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify([...set]));
    } catch {
      /* storage unavailable: the checklist still works for this view */
    }
  }, [key, set]);
  const toggle = (i: number) =>
    setSet((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return [set, toggle] as const;
}

export function CookingMode() {
  const { id = '' } = useParams();
  const { recipes, loading, error, reload } = useRecipes();
  const recipe = recipes.find((r) => r.id === id);
  useDocumentTitle(recipe ? `Cooking: ${recipe.title}` : 'Cooking');
  const [params, setParams] = useSearchParams();
  const servings = Number(params.get('servings')) || recipe?.servings || 1;
  const total = recipe?.steps.length ?? 0;
  // The current step lives in the URL, so it survives re-renders and refreshes.
  const step = Math.min(Math.max(1, Number(params.get('step')) || 1), Math.max(1, total));
  const [showIngredients, setShowIngredients] = useState(false);
  const [checked, toggle] = useSessionSet(`cook:${id}:checked`);

  const go = useCallback(
    (n: number) => {
      if (n < 1 || n > total) return;
      const next = new URLSearchParams(params);
      next.set('step', String(n));
      setParams(next, { replace: true });
    },
    [params, setParams, total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, dialog')) return;
      if (e.key === 'ArrowRight') go(step + 1);
      if (e.key === 'ArrowLeft') go(step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, step]);

  const ingredients = useMemo(() => {
    if (!recipe) return [];
    const s = scaleIngredients(recipe.ingredients, recipe.servings, servings);
    return s.ok ? s.ingredients : recipe.ingredients;
  }, [recipe, servings]);

  if (!recipe) {
    if (loading) return <Loading />;
    if (error) return <ErrorState message={error} onRetry={reload} />;
    return (
      <EmptyState title="Recipe not found">
        <Link to="/recipes" className="btn btn-primary">
          Back to My Recipes
        </Link>
      </EmptyState>
    );
  }

  const exitTo = `/recipes/${recipe.id}${servings !== recipe.servings ? `?servings=${servings}` : ''}`;
  const progress = Math.round((step / total) * 100);

  return (
    <div className="cooking">
      <header className="cooking-head">
        <Link to={exitTo} className="btn btn-ghost">
          <IconClose size={18} /> Exit cooking mode
        </Link>
        <div className="cooking-title">
          <p className="kicker">Cooking{servings !== recipe.servings ? ` · ${servings} servings` : ''}</p>
          <h1>{recipe.title}</h1>
        </div>
        <button type="button" className="btn btn-ghost" aria-expanded={showIngredients} aria-controls="cook-ingredients" onClick={() => setShowIngredients((s) => !s)}>
          {showIngredients ? 'Hide ingredients' : `Ingredients (${checked.size}/${ingredients.length})`}
        </button>
      </header>

      <div className="cooking-body">
        <section className="cooking-step" aria-labelledby="step-label">
          <p id="step-label" className="step-label">
            Step {step} of {total}
          </p>
          <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step} aria-label="Recipe progress">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="step-text" aria-live="polite">
            {recipe.steps[step - 1]}
          </p>
          <nav className="step-nav" aria-label="Steps">
            <button type="button" className="btn btn-ghost btn-big" onClick={() => go(step - 1)} disabled={step <= 1}>
              <IconChevronLeft /> Previous
            </button>
            {step < total ? (
              <button type="button" className="btn btn-primary btn-big" onClick={() => go(step + 1)}>
                Next <IconChevronRight />
              </button>
            ) : (
              <Link to={exitTo} className="btn btn-primary btn-big">
                Finish
              </Link>
            )}
          </nav>
          <ol className="step-dots" aria-label="Jump to step">
            {recipe.steps.map((_, i) => (
              <li key={i}>
                <button type="button" className={`dot ${i + 1 === step ? 'is-current' : ''}`} aria-label={`Go to step ${i + 1}`} aria-current={i + 1 === step ? 'step' : undefined} onClick={() => go(i + 1)} />
              </li>
            ))}
          </ol>
          <p className="muted small">Tip: use the ← and → arrow keys to move between steps.</p>
        </section>

        {showIngredients && (
          <aside id="cook-ingredients" className="cooking-ingredients" aria-label="Ingredients">
            <h2 className="section-title small-title">Ingredients</h2>
            <ul className="checklist">
              {ingredients.map((ing, i) => (
                <li key={i} className={checked.has(i) ? 'is-checked' : ''}>
                  <label>
                    <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
                    <span>{describeIngredient(ing)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}

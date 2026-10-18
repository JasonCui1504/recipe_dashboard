import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { describeIngredient, formatQuantity, scaleIngredients } from '../../shared/quantity';
import { totalMinutes } from '../../shared/search';
import { api, errorMessage } from '../api';
import { AddToPlanDialog } from '../components/AddToPlanDialog';
import { capitalize, EmptyState, ErrorState, FavoriteButton, formatMinutes, Loading, Modal } from '../components/common';
import { IconCalendar, IconCart, IconChevronLeft, IconCopy, IconEdit, IconPlay, IconSpark, IconTrash } from '../components/Icons';
import { RecipeArt } from '../components/RecipeArt';
import { ServingsStepper } from '../components/ServingsStepper';
import { useConfirm, useDocumentTitle, useLoader, useRecipes, useToast, useUnitSystem } from '../state';
import { toSystem } from '../../shared/units';

type Subs = Array<{ substitute: string; amount: string; note: string }>;

export function RecipeDetail() {
  const { id = '' } = useParams();
  const { recipes, loading, error, reload, upsert, remove } = useRecipes();
  const recipe = recipes.find((r) => r.id === id);
  useDocumentTitle(recipe?.title ?? 'Recipe');
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const servings = Number(params.get('servings')) || recipe?.servings || 1;
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [planOpen, setPlanOpen] = useState(false);
  const [skipStaples, setSkipStaples] = useState(true);
  const [busy, setBusy] = useState(false);
  const ai = useLoader(() => api.ai.settings(), []);
  const [units, setUnits] = useUnitSystem();
  const [subs, setSubs] = useState<{ index: number; loading: boolean; error: string | null; items: Subs } | null>(null);

  const scaled = useMemo(() => (recipe ? scaleIngredients(recipe.ingredients, recipe.servings, servings) : null), [recipe, servings]);

  if (!recipe) {
    if (loading) return <Loading />;
    if (error) return <ErrorState message={error} onRetry={reload} />;
    return (
      <div className="page">
        <EmptyState title="Recipe not found">
          <p>It may have been deleted.</p>
          <Link className="btn btn-primary" to="/recipes">
            Back to My Recipes
          </Link>
        </EmptyState>
      </div>
    );
  }

  const ingredients = scaled?.ok ? scaled.ingredients : recipe.ingredients;
  const setServings = (n: number) => {
    const next = new URLSearchParams(params);
    if (n === recipe.servings) next.delete('servings');
    else next.set('servings', String(n));
    setParams(next, { replace: true });
  };
  const toggle = (i: number) =>
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const addToShopping = async () => {
    setBusy(true);
    try {
      const r = await api.shopping.fromRecipe(recipe.id, servings, skipStaples);
      const parts = [`${r.added} added`, r.merged ? `${r.merged} combined with existing items` : ''].filter(Boolean);
      toast(`Shopping list updated: ${parts.join(', ')}.`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    try {
      const copy = await api.recipes.duplicate(recipe.id);
      upsert(copy);
      toast('Recipe duplicated.', 'success');
      navigate(`/recipes/${copy.id}/edit`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const del = async () => {
    const ok = await confirm({
      title: 'Delete this recipe?',
      message: (
        <p>
          “{recipe.title}” will be permanently deleted, along with any meal-plan entries that use it. Consider exporting a backup first. This can’t be
          undone.
        </p>
      ),
      confirmLabel: 'Delete recipe',
      danger: true,
    });
    if (!ok) return;
    try {
      const { mealsRemoved } = await api.recipes.remove(recipe.id);
      remove(recipe.id);
      toast(`Deleted “${recipe.title}”${mealsRemoved ? ` and ${mealsRemoved} planned meal${mealsRemoved === 1 ? '' : 's'}` : ''}.`, 'success');
      navigate('/recipes');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const askSubs = async (index: number) => {
    setSubs({ index, loading: true, error: null, items: [] });
    try {
      const r = await api.ai.substitutions(recipe.id, index);
      setSubs({ index, loading: false, error: null, items: r.substitutions });
    } catch (err) {
      setSubs({ index, loading: false, error: errorMessage(err), items: [] });
    }
  };

  const aiEnabled = ai.data?.enabled === true;
  const scaledNote = servings !== recipe.servings;

  return (
    <article className="page recipe-page">
      <Link to="/recipes" className="back-link">
        <IconChevronLeft size={18} /> My Recipes
      </Link>
      <header className="recipe-hero">
        <div className="recipe-hero-art">
          <RecipeArt recipe={recipe} />
        </div>
        <div className="recipe-hero-text">
          {recipe.cuisine && <p className="kicker">{recipe.cuisine}</p>}
          <h1 className="recipe-title">{recipe.title}</h1>
          {recipe.description && <p className="recipe-description">{recipe.description}</p>}
          <dl className="recipe-facts">
            <div>
              <dt>Prep</dt>
              <dd>{formatMinutes(recipe.prepMinutes)}</dd>
            </div>
            <div>
              <dt>Cook</dt>
              <dd>{formatMinutes(recipe.cookMinutes)}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{formatMinutes(totalMinutes(recipe))}</dd>
            </div>
            <div>
              <dt>Serves</dt>
              <dd>{recipe.servings}</dd>
            </div>
            <div>
              <dt>Difficulty</dt>
              <dd>{capitalize(recipe.difficulty)}</dd>
            </div>
            {recipe.rating && (
              <div>
                <dt>Your rating</dt>
                <dd aria-label={`${recipe.rating} out of 5`}>
                  {'★'.repeat(recipe.rating)}
                  <span className="muted">{'★'.repeat(5 - recipe.rating)}</span>
                </dd>
              </div>
            )}
          </dl>
          {(recipe.tags.length > 0 || recipe.dietary.length > 0) && (
            <ul className="tag-row">
              {recipe.dietary.map((d) => (
                <li key={`d-${d}`} className="tag tag-diet">
                  {d}
                </li>
              ))}
              {recipe.tags.map((t) => (
                <li key={t} className="tag">
                  <Link to={`/recipes?tag=${encodeURIComponent(t)}`}>{t}</Link>
                </li>
              ))}
            </ul>
          )}
          <div className="action-bar">
            <Link className="btn btn-primary" to={`/recipes/${recipe.id}/cook${scaledNote ? `?servings=${servings}` : ''}`}>
              <IconPlay size={18} /> Start Cooking
            </Link>
            <button type="button" className="btn btn-ghost" onClick={addToShopping} disabled={busy}>
              <IconCart size={18} /> Add Ingredients to Shopping List
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPlanOpen(true)}>
              <IconCalendar size={18} /> Add to Meal Plan
            </button>
            <Link className="btn btn-ghost" to={`/recipes/${recipe.id}/edit`}>
              <IconEdit size={18} /> Edit
            </Link>
            <FavoriteButton recipe={recipe} className="btn-fav" />
          </div>
          <label className="check-inline small">
            <input type="checkbox" checked={skipStaples} onChange={(e) => setSkipStaples(e.target.checked)} />
            Leave pantry staples (salt, oil…) off the shopping list
          </label>
        </div>
      </header>

      <div className="recipe-columns">
        <section className="ingredients-panel" aria-labelledby="ing-title">
          <div className="section-head">
            <h2 id="ing-title" className="section-title">
              Ingredients
            </h2>
            {checked.size > 0 && (
              <button type="button" className="btn btn-link" onClick={() => setChecked(new Set())}>
                Uncheck all
              </button>
            )}
          </div>
          <div className="servings-row">
            <span>Servings</span>
            <ServingsStepper value={servings} onChange={setServings} />
          </div>
          <div className="servings-row">
            <span id="units-label">Units</span>
            <div className="segmented segmented-small" role="group" aria-labelledby="units-label">
              {(
                [
                  ['original', 'As written'],
                  ['metric', 'Metric'],
                  ['us', 'US'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={units === id} onClick={() => setUnits(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {units !== 'original' && (
            <p className="muted small">≈ marks converted amounts. Cups and spoons are US measures; volume and weight are never swapped.</p>
          )}
          {scaledNote && (
            <p className="note" role="note">
              Quantities scaled from {recipe.servings} to {servings} servings. Cooking times, pan sizes and seasoning may not scale in a straight line — use
              your judgement.
            </p>
          )}
          {scaled && !scaled.ok && <p className="form-error">{scaled.error}</p>}
          <ul className="checklist">
            {ingredients.map((ing, i) => (
              <li key={i} className={checked.has(i) ? 'is-checked' : ''}>
                <label>
                  <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
                  <span>
                    {(() => {
                      const shown = toSystem(ing.quantity, ing.unit, units);
                      return (
                        <>
                          {shown.quantity !== null && (
                            <strong className="qty" title={shown.converted ? `Converted from ${formatQuantity(ing.quantity)} ${ing.unit}` : undefined}>
                              {shown.converted ? '≈ ' : ''}
                              {formatQuantity(shown.quantity)}{' '}
                            </strong>
                          )}
                          {shown.unit && <span>{shown.unit} </span>}
                        </>
                      );
                    })()}
                    <span>{ing.name}</span>
                    {ing.note && <span className="muted">, {ing.note}</span>}
                    {ing.optional && <span className="badge">optional</span>}
                  </span>
                </label>
                {aiEnabled && (
                  <button type="button" className="btn btn-link small" onClick={() => askSubs(i)} aria-label={`Suggest substitutes for ${ing.name}`}>
                    Substitute?
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="muted small">Ticking ingredients is just for this visit — it doesn’t change the recipe.</p>
        </section>

        <section className="steps-panel" aria-labelledby="steps-title">
          <h2 id="steps-title" className="section-title">
            Method
          </h2>
          <ol className="steps">
            {recipe.steps.map((s, i) => (
              <li key={i}>
                <span className="step-num" aria-hidden="true">
                  {i + 1}
                </span>
                <p>{s}</p>
              </li>
            ))}
          </ol>

          {recipe.notes && (
            <div className="notes-card">
              <h3>Your notes</h3>
              <p className="pre-line">{recipe.notes}</p>
            </div>
          )}
          {recipe.nutrition && (
            <div className="notes-card">
              <h3>Nutrition per serving</h3>
              <p className="muted small">
                {recipe.nutrition.basis === 'estimated' ? 'Estimated' : 'Entered by you'} — not verified, for general reference only.
              </p>
              <dl className="nutrition">
                {(['calories', 'protein', 'carbs', 'fat'] as const).map((k) =>
                  recipe.nutrition![k] !== null ? (
                    <div key={k}>
                      <dt>{capitalize(k)}</dt>
                      <dd>
                        {recipe.nutrition![k]}
                        {k === 'calories' ? ' kcal' : ' g'}
                      </dd>
                    </div>
                  ) : null,
                )}
              </dl>
            </div>
          )}
          {recipe.sourceNote && <p className="source-note">Source: {recipe.sourceNote}</p>}

          <div className="secondary-actions">
            <button type="button" className="btn btn-ghost" onClick={duplicate}>
              <IconCopy size={18} /> Duplicate
            </button>
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={del}>
              <IconTrash size={18} /> Delete
            </button>
          </div>
        </section>
      </div>

      <AddToPlanDialog open={planOpen} onClose={() => setPlanOpen(false)} recipe={recipe} />

      <Modal open={subs !== null} onClose={() => setSubs(null)} title={subs ? `Substitutes for ${recipe.ingredients[subs.index]?.name ?? ''}` : ''}>
        {subs?.loading && <Loading label="Asking your local model…" />}
        {subs?.error && (
          <div className="state state-error" role="alert">
            <p>{subs.error}</p>
            <p className="muted small">Without AI: check the recipe notes, or search your library for recipes that skip this ingredient.</p>
          </div>
        )}
        {subs && !subs.loading && !subs.error && (
          <>
            <p className="ai-label">
              <IconSpark size={16} /> AI suggestions from your local model — unverified. Check allergens and food safety yourself.
            </p>
            <ul className="subs">
              {subs.items.map((s, i) => (
                <li key={i}>
                  <strong>{s.substitute}</strong>
                  {s.amount && <span> — {s.amount}</span>}
                  {s.note && <p className="muted small">{s.note}</p>}
                </li>
              ))}
            </ul>
            <p className="muted small">Your saved recipe has not been changed. Edit it yourself if you want to keep a substitute.</p>
            <p className="muted small">Original: {describeIngredient(recipe.ingredients[subs.index])}</p>
          </>
        )}
      </Modal>
    </article>
  );
}

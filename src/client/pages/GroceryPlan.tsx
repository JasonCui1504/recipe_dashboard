import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, formatDay, formatWeekRange, isValidIsoDate, startOfWeek, toIsoDate } from '../../shared/dates';
import { defaultShoppingWeekOffset, planGroceries, suggestBuying, type GroceryLine } from '../../shared/planning';
import { formatQuantity } from '../../shared/quantity';
import { groupByCategory } from '../../shared/shopping';
import { api, errorMessage } from '../api';
import { EmptyState, ErrorState, Loading, PageHeader } from '../components/common';
import { IconCalendar, IconCart, IconChevronLeft, IconChevronRight } from '../components/Icons';
import { useDocumentTitle, useLoader, useRecipes, useToast } from '../state';

/**
 * "What do I need to buy for this week's menu?" — combines every planned
 * meal's (scaled) ingredients, flags what's already in the pantry, and lets
 * you untick anything before adding the rest to the shopping list.
 */
export function GroceryPlan() {
  useDocumentTitle('Grocery plan');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const thisWeek = startOfWeek(toIsoDate(new Date()));
  const weekParam = params.get('week');
  const weekStart = weekParam && isValidIsoDate(weekParam) ? startOfWeek(weekParam) : addDays(thisWeek, defaultShoppingWeekOffset(new Date()) * 7);
  const weekEnd = addDays(weekStart, 6);

  const { recipes, loading: recipesLoading } = useRecipes();
  const data = useLoader(
    () => Promise.all([api.meals.list(weekStart, weekEnd), api.pantry.list(), api.shopping.list()]),
    [weekStart],
  );

  const plan = useMemo(() => {
    if (!data.data) return null;
    const [meals, pantry] = data.data;
    return planGroceries(meals, recipes, pantry, (m, r) => `${r.title} · ${formatDay(m.date, { weekday: 'short' })} ${m.slot}`);
  }, [data.data, recipes]);

  // Ingredients already added to the shopping list for one of this week's meals.
  const onList = useMemo(() => {
    if (!data.data) return new Set<string>();
    const [meals, , shopping] = data.data;
    const mealIds = new Set(meals.map((m) => m.id));
    const keys = new Set<string>();
    for (const item of shopping) {
      if (item.sources.some((s) => s.kind === 'meal' && s.mealId && mealIds.has(s.mealId))) {
        keys.add(item.name.trim().toLowerCase());
      }
    }
    return keys;
  }, [data.data]);
  const isOnList = (l: GroceryLine) => onList.has(l.name.trim().toLowerCase());

  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (plan) setSelected(new Set(plan.lines.filter((l) => suggestBuying(l) && !isOnList(l)).map((l) => l.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, onList]);

  const [busy, setBusy] = useState(false);
  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const goWeek = (start: string) => setParams({ week: start });

  const addToList = async () => {
    setBusy(true);
    try {
      const r = await api.shopping.fromMeals(weekStart, weekEnd, false, [...selected]);
      toast(
        `Shopping list updated: ${r.added} added${r.merged ? `, ${r.merged} combined` : ''}${r.skipped ? `, ${r.skipped} already there` : ''}.`,
        'success',
      );
      navigate('/shopping');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const lines = plan?.lines ?? [];
  const selectedLines = lines.filter((l) => selected.has(l.key));
  const inPantry = lines.filter((l) => l.pantryItem).length;

  return (
    <div className="page grocery-page">
      <Link to="/shopping" className="back-link">
        <IconChevronLeft size={18} /> Shopping List
      </Link>
      <PageHeader title="Grocery plan" kicker={formatWeekRange(weekStart)}>
        <div className="week-nav" role="group" aria-label="Change week">
          <button type="button" className="icon-btn" onClick={() => goWeek(addDays(weekStart, -7))} aria-label="Previous week">
            <IconChevronLeft />
          </button>
          <button type="button" className="btn btn-ghost" aria-pressed={weekStart === thisWeek} onClick={() => goWeek(thisWeek)}>
            This week
          </button>
          <button type="button" className="btn btn-ghost" aria-pressed={weekStart === addDays(thisWeek, 7)} onClick={() => goWeek(addDays(thisWeek, 7))}>
            Next week
          </button>
          <button type="button" className="icon-btn" onClick={() => goWeek(addDays(weekStart, 7))} aria-label="Next week">
            <IconChevronRight />
          </button>
        </div>
      </PageHeader>

      {(data.loading && !data.data) || recipesLoading ? (
        <Loading label="Working out what you need…" />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : !plan || plan.mealCount === 0 ? (
        <EmptyState title="No meals planned for this week yet">
          <p>Choose lunches and dinners on the home page or in the planner, then come back here.</p>
          <div className="button-row">
            <Link className="btn btn-primary" to="/">
              Plan on the home page
            </Link>
            <Link className="btn btn-ghost" to={`/planner?week=${weekStart}`}>
              <IconCalendar size={18} /> Open Meal Planner
            </Link>
          </div>
        </EmptyState>
      ) : (
        <>
          <section className="card grocery-summary" aria-label="Summary">
            <dl className="recipe-facts">
              <div>
                <dt>Meals planned</dt>
                <dd>{plan.mealCount}</dd>
              </div>
              <div>
                <dt>Ingredients</dt>
                <dd>{lines.length}</dd>
              </div>
              <div>
                <dt>Already in pantry</dt>
                <dd>{inPantry}</dd>
              </div>
              <div>
                <dt>To buy</dt>
                <dd>{selectedLines.length}</dd>
              </div>
            </dl>
            <p className="muted small">
              Ticked items will be added to your shopping list. Things already in your pantry, pantry staples (salt, oil…) and optional
              ingredients start unticked — tick them if you’re running low. Pantry matching compares names only, so check quantities yourself.
            </p>
            <div className="button-row no-print">
              <button type="button" className="btn btn-link" onClick={() => setSelected(new Set(lines.filter(suggestBuying).map((l) => l.key)))}>
                Suggested
              </button>
              <button type="button" className="btn btn-link" onClick={() => setSelected(new Set(lines.map((l) => l.key)))}>
                Select all
              </button>
              <button type="button" className="btn btn-link" onClick={() => setSelected(new Set())}>
                Select none
              </button>
              <button type="button" className="btn btn-link" onClick={() => window.print()}>
                Print
              </button>
            </div>
          </section>

          {groupByCategory(lines).map(([category, group]) => (
            <section key={category} className="section" aria-label={category}>
              <h2 className="group-title">{category}</h2>
              <ul className="item-list">
                {group.map((l) => (
                  <li key={`${l.key}|${l.unit}|${l.quantity === null}`} className={`item-row grocery-row ${selected.has(l.key) ? '' : 'is-unselected'}`}>
                    <label className="shopping-check">
                      <input type="checkbox" checked={selected.has(l.key)} onChange={() => toggle(l.key)} />
                      <span className="item-main">
                        <span className="item-name">{l.name}</span>
                        {(l.quantity !== null || l.unit) && (
                          <span className="item-qty">
                            {formatQuantity(l.quantity)} {l.unit}
                          </span>
                        )}
                        {l.pantryItem && (
                          <span className="badge">
                            In pantry{l.pantryItem.quantity !== null ? `: ${formatQuantity(l.pantryItem.quantity)} ${l.pantryItem.unit}` : ''}
                          </span>
                        )}
                        {l.staple && <span className="badge">Staple</span>}
                        {l.optional && <span className="badge">Optional</span>}
                        {isOnList(l) && <span className="badge badge-soon">Already on your list</span>}
                        <span className="muted small item-source">For {l.usedIn.join('; ')}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <div className="form-footer no-print">
            <Link to={`/planner?week=${weekStart}`} className="btn btn-ghost">
              <IconCalendar size={18} /> Edit the menu
            </Link>
            <button type="button" className="btn btn-primary" onClick={addToList} disabled={busy || selected.size === 0}>
              <IconCart size={18} /> {busy ? 'Adding…' : `Add ${selectedLines.length} item${selectedLines.length === 1 ? '' : 's'} to shopping list`}
            </button>
          </div>
          <p className="muted small">
            Amounts are scaled to each meal’s servings and combined only when the name and unit match. Adding the same week again won’t
            double anything. Nothing is removed from your pantry.
          </p>
        </>
      )}
    </div>
  );
}

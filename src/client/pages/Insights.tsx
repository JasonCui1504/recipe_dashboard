import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatDay, toIsoDate } from '../../shared/dates';
import { computeInsights, PERIODS, type InsightsPeriod } from '../../shared/insights';
import { api } from '../api';
import { capitalize, EmptyState, ErrorState, formatMinutes, Loading, PageHeader } from '../components/common';
import { useDocumentTitle, useLoader, useRecipes } from '../state';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Card({ title, note, children, wide = false }: { title: string; note?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`card insight-card ${wide ? 'is-wide' : ''}`} aria-label={title}>
      <h2 className="section-title small-title">{title}</h2>
      {note && <p className="muted small insight-note">{note}</p>}
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>
        <span className="stat-value">{value}</span>
        {sub && <span className="stat-sub">{sub}</span>}
      </dd>
    </div>
  );
}

/** Ranked horizontal bars (one series, one hue). Values are always written out; hover adds detail. */
function RankedBars({ rows, unit }: { rows: Array<{ label: ReactNode; key: string; value: number; detail?: string }>; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="bars">
      {rows.map((r) => (
        <li key={r.key} className="bar-row" data-tip={r.detail ?? `${plural(r.value, unit)}`} tabIndex={0}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="bar-value">{r.value}</span>
        </li>
      ))}
    </ol>
  );
}

function WeeklyChart({ weeks }: { weeks: Array<{ weekStart: string; count: number }> }) {
  const max = Math.max(1, ...weeks.map((w) => w.count));
  return (
    <>
      <div className="week-chart" role="img" aria-label={`Meals planned per week: ${weeks.map((w) => `${formatDay(w.weekStart, { month: 'short', day: 'numeric' })} ${w.count}`).join(', ')}`}>
        {weeks.map((w) => (
          <div key={w.weekStart} className="week-col" data-tip={`Week of ${formatDay(w.weekStart, { month: 'short', day: 'numeric' })}: ${plural(w.count, 'meal')}`}>
            <span className="week-count">{w.count || ''}</span>
            <span className="week-bar" style={{ height: `${(w.count / max) * 100}%` }} />
            <span className="week-label">{formatDay(w.weekStart, { month: 'numeric', day: 'numeric' })}</span>
          </div>
        ))}
      </div>
      <table className="visually-hidden">
        <caption>Meals planned per week</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Meals</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.weekStart}>
              <td>{w.weekStart}</td>
              <td>{w.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Insights() {
  useDocumentTitle('Insights');
  const [period, setPeriod] = useState<InsightsPeriod>('4w');
  const today = toIsoDate(new Date());
  const { recipes, loading: recipesLoading } = useRecipes();
  const data = useLoader(
    () => Promise.all([api.meals.list('2000-01-01', '2999-12-31'), api.pantry.list(), api.shopping.list(), api.stores.list()]),
    [],
  );

  const insights = useMemo(() => {
    if (!data.data) return null;
    const [meals, pantry, shopping, stores] = data.data;
    return computeInsights({ recipes, meals, pantry, shopping, stores, period, today });
  }, [data.data, recipes, period, today]);

  return (
    <div className="page insights-page">
      <PageHeader title="Insights" kicker="From your meal plans, recipes and pantry">
        <div className="segmented" role="group" aria-label="Time period">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </PageHeader>

      {(data.loading && !data.data) || recipesLoading ? (
        <Loading label="Crunching the numbers…" />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : !insights ? null : (
        <>
          <p className="muted small">Meals count as cooked once their planned day has passed. Future plans aren’t included.</p>
          <dl className="stats">
            <Stat label="Meals planned" value={insights.mealCount} sub={`${insights.mealsPerWeek} a week`} />
            <Stat label="Different recipes" value={insights.distinctRecipes} sub={`${insights.neverPlanned} never planned yet`} />
            <Stat label="Vegetarian meals" value={pct(insights.vegetarianShare)} sub="labelled vegetarian or vegan" />
            <Stat
              label="Average cooking time"
              value={insights.avgMinutes === null ? '—' : formatMinutes(insights.avgMinutes)}
              sub={insights.quickShare === null ? undefined : `${pct(insights.quickShare)} ready in 30 min or less`}
            />
          </dl>

          {insights.mealCount === 0 && (
            <EmptyState title="No meal history for this period yet">
              <p>
                Plan meals on the home page or in the <Link to="/planner">Meal Planner</Link>. Once their day passes, they show up here.
              </p>
            </EmptyState>
          )}

          <div className="insight-grid">
            {insights.mealCount > 0 && (
              <>
                <Card title="Most cooked recipes">
                  <RankedBars
                    unit="time"
                    rows={insights.topRecipes.map((r) => ({
                      key: r.item.id,
                      label: <Link to={`/recipes/${r.item.id}`}>{r.item.title}</Link>,
                      value: r.count,
                      detail: `${plural(r.count, 'time')} · last on ${formatDay(r.lastDate)}`,
                    }))}
                  />
                </Card>
                <Card title="Most used ingredients" note="Number of meals each ingredient went into. Staples like salt and oil are left out.">
                  <RankedBars
                    unit="meal"
                    rows={insights.topIngredients.map((r) => ({
                      key: r.item,
                      label: capitalize(r.item),
                      value: r.count,
                      detail: `${plural(r.count, 'meal')} · ${plural(r.recipes, 'recipe')}`,
                    }))}
                  />
                </Card>
                <Card title="Meals per week" wide>
                  <WeeklyChart weeks={insights.weekly} />
                </Card>
                <Card title="What you cook" note="Categories across your meals, and how challenging they were.">
                  <RankedBars unit="meal" rows={insights.categories.map((c) => ({ key: c.item, label: capitalize(c.item), value: c.count }))} />
                  <p className="difficulty-mix">
                    {(['easy', 'medium', 'hard'] as const).map((d) => (
                      <span key={d}>
                        {capitalize(d)} <strong>{insights.difficulty[d]}</strong>
                      </span>
                    ))}
                  </p>
                </Card>
              </>
            )}

            <Card
              title="Most veggie-packed recipes"
              note="Counts the vegetables, fruit and legumes in each recipe. A rough guide from the ingredient list, not a health rating."
            >
              {insights.veggiePacked.length === 0 ? (
                <p className="muted">No recipes with vegetables yet.</p>
              ) : (
                <RankedBars
                  unit="plant"
                  rows={insights.veggiePacked.map((v) => ({
                    key: v.recipe.id,
                    label: <Link to={`/recipes/${v.recipe.id}`}>{v.recipe.title}</Link>,
                    value: v.plants,
                    detail: `${plural(v.plants, 'vegetable, fruit or legume')}`,
                  }))}
                />
              )}
            </Card>

            <Card title="Lightest & most protein" note="From nutrition you’ve entered on recipes (per serving). Unverified — for your own reference.">
              {insights.lightest.length === 0 && insights.mostProtein.length === 0 ? (
                <p className="muted">
                  Add calories or protein under “Notes & extras” when editing a recipe to see this. Nothing is estimated for you.
                </p>
              ) : (
                <div className="two-lists">
                  <div>
                    <h3 className="group-title">Fewest calories</h3>
                    <ol className="plain-list">
                      {insights.lightest.map((l) => (
                        <li key={l.recipe.id}>
                          <Link to={`/recipes/${l.recipe.id}`}>{l.recipe.title}</Link> <span className="muted">{l.calories} kcal</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <h3 className="group-title">Most protein</h3>
                    <ol className="plain-list">
                      {insights.mostProtein.map((l) => (
                        <li key={l.recipe.id}>
                          <Link to={`/recipes/${l.recipe.id}`}>{l.recipe.title}</Link> <span className="muted">{l.protein} g</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              )}
            </Card>

            <Card title="Worth cooking again" note="Favorites and 4–5 star recipes you haven’t planned in the last 30 days.">
              {insights.revisit.length === 0 ? (
                <p className="muted">You’ve been cooking your favorites lately. Nice.</p>
              ) : (
                <ul className="plain-list">
                  {insights.revisit.map((r) => (
                    <li key={r.recipe.id}>
                      <Link to={`/recipes/${r.recipe.id}`}>{r.recipe.title}</Link>{' '}
                      <span className="muted">{r.lastDate ? `last ${formatDay(r.lastDate)}` : 'never planned'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Pantry & food waste">
              <dl className="stats stats-small">
                <Stat label="On hand" value={insights.pantry.onHand} />
                <Stat label="Finished" value={insights.pantry.finished} sub={period === 'all' ? 'all time' : 'this period'} />
                <Stat label="Expired" value={insights.pantry.expired.length} sub="still on your list" />
              </dl>
              {insights.pantry.expired.length > 0 && (
                <p className="small">
                  <span className="badge badge-warn">Expired</span> {insights.pantry.expired.join(', ')} — check them or{' '}
                  <Link to="/pantry">strike them off</Link>.
                </p>
              )}
              {insights.pantry.expiringSoon.length > 0 && (
                <p className="small">
                  <span className="badge badge-soon">Use soon</span> {insights.pantry.expiringSoon.join(', ')} —{' '}
                  <Link to="/pantry?tab=cook">see what you can cook</Link>.
                </p>
              )}
            </Card>

            <Card title="Shopping list by store" note={`${plural(insights.shoppingOpen, 'item')} still to buy.`}>
              {insights.shoppingByStore.length === 0 ? (
                <p className="muted">Your shopping list is empty.</p>
              ) : (
                <RankedBars unit="item" rows={insights.shoppingByStore.map((s) => ({ key: s.item, label: s.item, value: s.count }))} />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

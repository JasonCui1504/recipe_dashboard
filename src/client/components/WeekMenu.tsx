import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDay, toIsoDate, weekDays } from '../../shared/dates';
import type { Meal, Recipe } from '../../shared/schema';
import { api, ApiError, errorMessage } from '../api';
import { useConfirm, useLoader, useRecipes, useToast } from '../state';
import { ErrorState, Loading } from './common';
import { IconClose } from './Icons';
import { RecipePicker } from './RecipePicker';

const SLOTS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
] as const;

/**
 * A compact breakfast, lunch & dinner calendar for one week. Pick a recipe from the
 * dropdown in any empty slot and it's planned immediately.
 */
export function WeekMenu({ weekStart }: { weekStart: string }) {
  const days = weekDays(weekStart);
  const meals = useLoader(() => api.meals.list(days[0], days[6]), [weekStart]);
  const { recipes } = useRecipes();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const today = toIsoDate(new Date());

  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);

  const plan = async (date: string, slot: string, recipe: Recipe) => {
    const key = `${date}-${slot}`;
    setBusy(key);
    const meal = { date, slot, recipeId: recipe.id, servings: recipe.servings, note: '' };
    try {
      let added: Meal;
      try {
        added = await api.meals.add(meal);
      } catch (err) {
        if (!(err instanceof ApiError && err.code === 'repeat')) throw err;
        const ok = await confirm({
          title: 'Repeat this meal?',
          message: <p>{err.message} Plan it again?</p>,
          confirmLabel: 'Yes, repeat it',
        });
        if (!ok) return;
        added = await api.meals.add(meal, true);
      }
      meals.setData((list) => [...list, added]);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (meal: Meal) => {
    try {
      await api.meals.remove(meal.id);
      meals.setData((list) => list.filter((m) => m.id !== meal.id));
      toast(`Removed ${byId.get(meal.recipeId)?.title ?? 'meal'} from the menu.`, 'info');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  if (meals.loading && !meals.data) return <Loading label="Loading your menu…" />;
  if (meals.error) return <ErrorState message={meals.error} onRetry={meals.reload} />;

  return (
    <ol className="menu-week">
      {days.map((day, dayIndex) => (
        <li key={day} className={`menu-day ${day === today ? 'is-today' : ''}`}>
          <h3 className="menu-day-title">
            <span>{formatDay(day, { weekday: 'short' })}</span>
            <span className="muted">{formatDay(day, { month: 'short', day: 'numeric' })}</span>
          </h3>
          {SLOTS.map(({ id: slot, label }) => {
            const planned = (meals.data ?? []).filter((m) => m.date === day && m.slot === slot);
            return (
              <div key={slot} className="menu-slot">
                <span className="menu-slot-label">
                  {label}
                </span>
                {planned.map((m) => {
                  const r = byId.get(m.recipeId);
                  return (
                    <div key={m.id} className="menu-meal">
                      <Link to={`/recipes/${m.recipeId}?servings=${m.servings}`}>{r?.title ?? 'Unknown recipe'}</Link>
                      <button
                        type="button"
                        className="icon-btn small-icon"
                        onClick={() => remove(m)}
                        aria-label={`Remove ${r?.title ?? 'meal'} from ${label.toLowerCase()} on ${formatDay(day, { weekday: 'long' })}`}
                      >
                        <IconClose size={14} />
                      </button>
                    </div>
                  );
                })}
                {planned.length === 0 &&
                  (busy === `${day}-${slot}` ? (
                    <p className="muted small menu-adding">Adding…</p>
                  ) : (
                    <RecipePicker
                      compact
                      alignRight={dayIndex >= 5}
                      placeholder="Search…"
                      label={`Choose ${label.toLowerCase()} for ${formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}`}
                      disabled={recipes.length === 0}
                      onSelect={(r) => void plan(day, slot, r)}
                    />
                  ))}
              </div>
            );
          })}
        </li>
      ))}
    </ol>
  );
}

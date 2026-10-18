import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, formatDay, formatWeekRange, isValidIsoDate, startOfWeek, toIsoDate, weekDays } from '../../shared/dates';
import type { Meal } from '../../shared/schema';
import { api, errorMessage } from '../api';
import { AddToPlanDialog } from '../components/AddToPlanDialog';
import { capitalize, ErrorState, Loading, PageHeader } from '../components/common';
import { IconCart, IconChevronLeft, IconChevronRight, IconClose, IconPlus } from '../components/Icons';
import { useConfirm, useDocumentTitle, useLoader, useRecipes, useToast } from '../state';

const DEFAULT_SLOTS = ['breakfast', 'lunch', 'dinner'];

export function Planner() {
  useDocumentTitle('Meal Planner');
  const [params, setParams] = useSearchParams();
  const today = toIsoDate(new Date());
  const weekParam = params.get('week');
  const weekStart = startOfWeek(weekParam && isValidIsoDate(weekParam) ? weekParam : today);
  const weekEnd = addDays(weekStart, 6);
  const meals = useLoader(() => api.meals.list(weekStart, weekEnd), [weekStart]);
  const { recipes } = useRecipes();
  const toast = useToast();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<{ date: string; slot?: string } | null>(null);

  const goWeek = (start: string) => setParams(start === startOfWeek(today) ? {} : { week: start });
  const recipeById = new Map(recipes.map((r) => [r.id, r]));

  const removeMeal = async (meal: Meal) => {
    const title = recipeById.get(meal.recipeId)?.title ?? 'this meal';
    const ok = await confirm({
      title: 'Remove from plan?',
      message: <p>Remove {title} from {capitalize(meal.slot)} on {formatDay(meal.date)}? The recipe itself is kept.</p>,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await api.meals.remove(meal.id);
      meals.setData((list) => list.filter((m) => m.id !== meal.id));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const changeServings = async (meal: Meal, servings: number) => {
    try {
      const updated = await api.meals.setServings(meal.id, servings);
      meals.setData((list) => list.map((m) => (m.id === meal.id ? updated : m)));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const days = weekDays(weekStart);
  const total = meals.data?.length ?? 0;

  return (
    <div className="page">
      <PageHeader title="Meal Planner" kicker={formatWeekRange(weekStart)}>
        <div className="week-nav" role="group" aria-label="Change week">
          <button type="button" className="icon-btn" onClick={() => goWeek(addDays(weekStart, -7))} aria-label="Previous week">
            <IconChevronLeft />
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => goWeek(startOfWeek(today))} disabled={weekStart === startOfWeek(today)}>
            This week
          </button>
          <button type="button" className="icon-btn" onClick={() => goWeek(addDays(weekStart, 7))} aria-label="Next week">
            <IconChevronRight />
          </button>
        </div>
      </PageHeader>

      <div className="planner-toolbar">
        <p className="muted">
          {total} meal{total === 1 ? '' : 's'} planned this week
        </p>
        <div className="button-row">
          <Link className="btn btn-primary" to={`/shopping/plan?week=${weekStart}`}>
            <IconCart size={18} /> Review groceries for this week
          </Link>
        </div>
      </div>

      {meals.loading && !meals.data ? (
        <Loading />
      ) : meals.error ? (
        <ErrorState message={meals.error} onRetry={meals.reload} />
      ) : (
        <ol className="week">
          {days.map((day) => {
            const dayMeals = (meals.data ?? []).filter((m) => m.date === day);
            const slots = [...DEFAULT_SLOTS, ...new Set(dayMeals.map((m) => m.slot).filter((s) => !DEFAULT_SLOTS.includes(s)))];
            return (
              <li key={day} className={`day ${day === today ? 'is-today' : ''}`} aria-label={formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}>
                <h2 className="day-title">
                  <span>{formatDay(day, { weekday: 'long' })}</span>
                  <span className="muted">{formatDay(day, { month: 'short', day: 'numeric' })}</span>
                  {day === today && <span className="badge">Today</span>}
                </h2>
                <div className="slots">
                  {slots.map((slot) => {
                    const inSlot = dayMeals.filter((m) => m.slot === slot);
                    return (
                      <div key={slot} className="slot">
                        <h3 className="slot-title">{capitalize(slot)}</h3>
                        {inSlot.map((meal) => {
                          const recipe = recipeById.get(meal.recipeId);
                          return (
                            <div key={meal.id} className="meal">
                              <Link to={`/recipes/${meal.recipeId}?servings=${meal.servings}`} className="meal-title">
                                {recipe?.title ?? 'Unknown recipe'}
                              </Link>
                              <label className="meal-servings">
                                <span className="visually-hidden">Servings for {recipe?.title}</span>
                                <select value={meal.servings} onChange={(e) => changeServings(meal, Number(e.target.value))}>
                                  {Array.from({ length: 12 }, (_, i) => i + 1)
                                    .concat(meal.servings > 12 ? [meal.servings] : [])
                                    .map((n) => (
                                      <option key={n} value={n}>
                                        {n} serving{n === 1 ? '' : 's'}
                                      </option>
                                    ))}
                                </select>
                              </label>
                              <button type="button" className="icon-btn small-icon" onClick={() => removeMeal(meal)} aria-label={`Remove ${recipe?.title ?? 'meal'} from ${slot}`}>
                                <IconClose size={16} />
                              </button>
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          className={inSlot.length ? 'btn btn-link small' : 'slot-empty'}
                          onClick={() => setDialog({ date: day, slot })}
                          aria-label={`Add a recipe to ${slot} on ${formatDay(day, { weekday: 'long' })}`}
                        >
                          {inSlot.length ? '+ Add another' : '+ Add'}
                        </button>
                      </div>
                    );
                  })}
                  <button type="button" className="btn btn-link small" onClick={() => setDialog({ date: day, slot: 'custom-new' })}>
                    <IconPlus size={14} /> Custom meal
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <AddToPlanDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        date={dialog?.date}
        slot={dialog?.slot === 'custom-new' ? '' : dialog?.slot}
        onAdded={(meal) => {
          if (meal.date >= weekStart && meal.date <= weekEnd) meals.setData((list) => [...list, meal]);
        }}
      />
    </div>
  );
}

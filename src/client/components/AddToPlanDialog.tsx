import { useEffect, useState } from 'react';
import { toIsoDate } from '../../shared/dates';
import { MEAL_SLOTS, type Meal, type Recipe } from '../../shared/schema';
import { api, ApiError, errorMessage } from '../api';
import { useConfirm, useRecipes, useToast } from '../state';
import { capitalize, Modal } from './common';
import { RecipePicker } from './RecipePicker';

interface Props {
  open: boolean;
  onClose: () => void;
  recipe?: Recipe;
  date?: string;
  slot?: string;
  onAdded?: (meal: Meal) => void;
}

export function AddToPlanDialog({ open, onClose, recipe, date, slot, onAdded }: Props) {
  const { recipes } = useRecipes();
  const confirm = useConfirm();
  const toast = useToast();
  const [recipeId, setRecipeId] = useState(recipe?.id ?? '');
  const [day, setDay] = useState(date ?? toIsoDate(new Date()));
  const [slotChoice, setSlotChoice] = useState('dinner');
  const [customSlot, setCustomSlot] = useState('');
  const [servings, setServings] = useState(recipe?.servings ?? 2);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRecipeId(recipe?.id ?? '');
    setDay(date ?? toIsoDate(new Date()));
    // An empty string means "start with a custom slot".
    const isCustom = slot !== undefined && !MEAL_SLOTS.includes(slot as (typeof MEAL_SLOTS)[number]);
    setSlotChoice(isCustom ? 'custom' : (slot ?? 'dinner'));
    setCustomSlot(isCustom ? (slot ?? '') : '');
    setServings(recipe?.servings ?? 2);
    setError(null);
  }, [open, recipe, date, slot]);

  const chosen = recipe ?? recipes.find((r) => r.id === recipeId);
  useEffect(() => {
    if (!recipe && chosen) setServings(chosen.servings);
  }, [recipe, chosen]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSlot = slotChoice === 'custom' ? customSlot.trim() : slotChoice;
    if (!chosen) return setError('Choose a recipe.');
    if (!finalSlot) return setError('Name your custom meal slot.');
    if (!day) return setError('Choose a date.');
    setBusy(true);
    setError(null);
    const meal = { date: day, slot: finalSlot, recipeId: chosen.id, servings, note: '' };
    try {
      let added: Meal;
      try {
        added = await api.meals.add(meal);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'repeat') {
          const ok = await confirm({
            title: 'Repeat this meal?',
            message: `${err.message} Do you want to plan it again?`,
            confirmLabel: 'Yes, repeat it',
          });
          if (!ok) return;
          added = await api.meals.add(meal, true);
        } else throw err;
      }
      toast(`Planned ${chosen.title} for ${capitalize(finalSlot)}, ${day}.`, 'success');
      onAdded?.(added);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={recipe ? `Plan “${recipe.title}”` : 'Add a meal'}>
      <form className="form" onSubmit={submit}>
        {!recipe && (
          <div className="field">
            <span className="label" id="plan-recipe-label">
              Recipe
            </span>
            {chosen ? (
              <div className="picked-recipe">
                <span className="picked-title">{chosen.title}</span>
                <button type="button" className="btn btn-link small" onClick={() => setRecipeId('')}>
                  Change
                </button>
              </div>
            ) : (
              <RecipePicker label="Search for a recipe" placeholder="Type a recipe, ingredient or tag…" autoFocus onSelect={(r) => setRecipeId(r.id)} />
            )}
          </div>
        )}
        <div className="field-row">
          <label className="field">
            <span className="label">Date</span>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
          </label>
          <label className="field">
            <span className="label">Meal</span>
            <select value={slotChoice} onChange={(e) => setSlotChoice(e.target.value)}>
              {MEAL_SLOTS.map((s) => (
                <option key={s} value={s}>
                  {capitalize(s)}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </label>
        </div>
        {slotChoice === 'custom' && (
          <label className="field">
            <span className="label">Custom meal name</span>
            <input value={customSlot} maxLength={30} onChange={(e) => setCustomSlot(e.target.value)} placeholder="e.g. Picnic" />
          </label>
        )}
        <label className="field field-narrow">
          <span className="label">Servings</span>
          <input type="number" min={1} max={100} value={servings} onChange={(e) => setServings(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Adding…' : 'Add to plan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, toIsoDate } from '../../shared/dates';
import { guessCategory } from '../../shared/ingredients';
import { matchRecipes, type RecipeMatch } from '../../shared/matching';
import { describeIngredient, formatQuantity, parseQuantity } from '../../shared/quantity';
import { DIFFICULTIES, type PantryInput, type PantryItem } from '../../shared/schema';
import { collectTags, totalMinutes } from '../../shared/search';
import { groupByCategory } from '../../shared/shopping';
import { api, ApiError, errorMessage } from '../api';
import { capitalize, EmptyState, ErrorState, formatMinutes, Loading, Modal, PageHeader } from '../components/common';
import { IconCart, IconEdit, IconPlus, IconTrash } from '../components/Icons';
import { useConfirm, useDocumentTitle, useLoader, useRecipes, useToast } from '../state';

interface PantryFormState {
  name: string;
  quantity: string;
  unit: string;
  category: string;
  expiresOn: string;
  notes: string;
}
const emptyForm: PantryFormState = { name: '', quantity: '', unit: '', category: '', expiresOn: '', notes: '' };

function toInput(f: PantryFormState, usedUp = false): { input?: PantryInput; error?: string } {
  if (!f.name.trim()) return { error: 'Give the item a name.' };
  let quantity: number | null = null;
  if (f.quantity.trim()) {
    quantity = parseQuantity(f.quantity);
    if (quantity === null) return { error: `Couldn’t read the quantity “${f.quantity}”. Use a number like 2 or 1 1/2.` };
  }
  return {
    input: {
      name: f.name.trim(),
      quantity,
      unit: f.unit.trim(),
      category: f.category.trim() || guessCategory(f.name),
      expiresOn: f.expiresOn || null,
      notes: f.notes.trim(),
      usedUp,
    },
  };
}

function PantryFields({ form, setForm, idPrefix }: { form: PantryFormState; setForm: (f: PantryFormState) => void; idPrefix: string }) {
  const field = (k: keyof PantryFormState) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value }),
    id: `${idPrefix}-${k}`,
  });
  return (
    <div className="pantry-fields">
      <label className="field field-grow">
        <span className="label">Ingredient *</span>
        <input {...field('name')} maxLength={120} placeholder="e.g. eggs" />
      </label>
      <label className="field field-qty">
        <span className="label">Quantity</span>
        <input {...field('quantity')} inputMode="decimal" />
      </label>
      <label className="field field-unit">
        <span className="label">Unit</span>
        <input {...field('unit')} maxLength={30} />
      </label>
      <label className="field">
        <span className="label">Category</span>
        <input {...field('category')} maxLength={40} placeholder="Auto" list="pantry-categories" />
      </label>
      <label className="field">
        <span className="label">Expires</span>
        <input {...field('expiresOn')} type="date" />
      </label>
      <label className="field field-grow">
        <span className="label">Notes</span>
        <input {...field('notes')} maxLength={500} />
      </label>
    </div>
  );
}

export function Pantry() {
  useDocumentTitle('Pantry');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'cook' ? 'cook' : 'inventory';
  const pantry = useLoader(() => api.pantry.list(), []);

  return (
    <div className="page">
      <PageHeader title="Pantry" kicker="What you have on hand" />
      <div className="tabs" role="tablist" aria-label="Pantry views">
        <button type="button" role="tab" id="tab-inventory" aria-controls="panel-inventory" aria-selected={tab === 'inventory'} className="tab" onClick={() => setParams({}, { replace: true })}>
          Inventory
        </button>
        <button type="button" role="tab" id="tab-cook" aria-controls="panel-cook" aria-selected={tab === 'cook'} className="tab" onClick={() => setParams({ tab: 'cook' }, { replace: true })}>
          What can I cook?
        </button>
      </div>
      {pantry.loading && !pantry.data ? (
        <Loading />
      ) : pantry.error ? (
        <ErrorState message={pantry.error} onRetry={pantry.reload} />
      ) : tab === 'inventory' ? (
        <div role="tabpanel" id="panel-inventory" aria-labelledby="tab-inventory">
          <Inventory items={pantry.data ?? []} setItems={(fn) => pantry.setData(fn)} />
        </div>
      ) : (
        <div role="tabpanel" id="panel-cook" aria-labelledby="tab-cook">
          <WhatCanICook pantry={pantry.data ?? []} />
        </div>
      )}
    </div>
  );
}

function Inventory({ items, setItems }: { items: PantryItem[]; setItems: (fn: (items: PantryItem[]) => PantryItem[]) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<PantryFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item: PantryItem; form: PantryFormState; error: string | null } | null>(null);
  const [showUsed, setShowUsed] = useState(false);
  const today = toIsoDate(new Date());
  const soon = addDays(today, 3);

  const replace = (item: PantryItem) => setItems((list) => list.map((i) => (i.id === item.id ? item : i)));

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { input, error: err } = toInput(form);
    if (!input) return setError(err ?? null);
    try {
      const item = await api.pantry.create(input);
      setItems((list) => [...list, item].sort((a, b) => a.name.localeCompare(b.name)));
      setForm(emptyForm);
      setError(null);
      toast(`Added ${item.name} to your pantry.`, 'success');
    } catch (err) {
      setError(err instanceof ApiError && err.details.length ? err.details.join(' ') : errorMessage(err));
    }
  };

  const toggleUsed = async (item: PantryItem) => {
    const { id: _i, createdAt: _c, updatedAt: _u, ...input } = item;
    try {
      const updated = await api.pantry.update(item.id, { ...input, usedUp: !item.usedUp });
      replace(updated);
      toast(updated.usedUp ? `Marked ${item.name} as used up.` : `${item.name} is back in your pantry.`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const { input, error: err } = toInput(editing.form, editing.item.usedUp);
    if (!input) return setEditing({ ...editing, error: err ?? null });
    try {
      replace(await api.pantry.update(editing.item.id, input));
      setEditing(null);
      toast('Pantry item updated.', 'success');
    } catch (err) {
      setEditing({ ...editing, error: errorMessage(err) });
    }
  };

  const del = async (item: PantryItem) => {
    const ok = await confirm({ title: `Remove ${item.name}?`, message: <p>This removes it from your pantry list.</p>, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try {
      await api.pantry.remove(item.id);
      setItems((list) => list.filter((i) => i.id !== item.id));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const active = items.filter((i) => !i.usedUp);
  const used = items.filter((i) => i.usedUp);
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))];

  return (
    <>
      <form className="card form add-form" onSubmit={add} aria-labelledby="add-pantry-title">
        <h2 id="add-pantry-title" className="section-title small-title">
          Add to pantry
        </h2>
        <PantryFields form={form} setForm={setForm} idPrefix="add" />
        <datalist id="pantry-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button type="submit" className="btn btn-primary">
            <IconPlus size={18} /> Add item
          </button>
        </div>
      </form>

      {active.length === 0 ? (
        <EmptyState title="Your pantry is empty">
          <p>Add a few things you have — eggs, rice, an onion — and see what you can cook.</p>
        </EmptyState>
      ) : (
        groupByCategory(active).map(([category, list]) => (
          <section key={category} className="section" aria-label={category}>
            <h2 className="group-title">{category}</h2>
            <ul className="item-list">
              {list.map((item) => {
                const expired = item.expiresOn && item.expiresOn < today;
                const expiring = !expired && item.expiresOn && item.expiresOn <= soon;
                return (
                  <li key={item.id} className="item-row">
                    <div className="item-main">
                      <span className="item-name">{item.name}</span>
                      {item.quantity !== null && (
                        <span className="item-qty">
                          {formatQuantity(item.quantity)} {item.unit}
                        </span>
                      )}
                      {item.expiresOn && (
                        <span className={`badge ${expired ? 'badge-warn' : expiring ? 'badge-soon' : ''}`}>
                          {expired ? 'Expired' : 'Use by'} {item.expiresOn}
                        </span>
                      )}
                      {item.notes && <span className="muted small item-notes">{item.notes}</span>}
                    </div>
                    <div className="item-actions">
                      <button type="button" className="btn btn-link small" onClick={() => toggleUsed(item)}>
                        Mark used
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Edit ${item.name}`}
                        onClick={() =>
                          setEditing({
                            item,
                            error: null,
                            form: {
                              name: item.name,
                              quantity: item.quantity === null ? '' : formatQuantity(item.quantity),
                              unit: item.unit,
                              category: item.category,
                              expiresOn: item.expiresOn ?? '',
                              notes: item.notes,
                            },
                          })
                        }
                      >
                        <IconEdit size={18} />
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Remove ${item.name}`} onClick={() => del(item)}>
                        <IconTrash size={18} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {used.length > 0 && (
        <section className="section">
          <button type="button" className="btn btn-link" aria-expanded={showUsed} onClick={() => setShowUsed((s) => !s)}>
            {showUsed ? 'Hide' : 'Show'} used-up items ({used.length})
          </button>
          {showUsed && (
            <ul className="item-list is-muted">
              {used.map((item) => (
                <li key={item.id} className="item-row">
                  <span className="item-name">{item.name}</span>
                  <div className="item-actions">
                    <button type="button" className="btn btn-link small" onClick={() => toggleUsed(item)}>
                      Restock
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Remove ${item.name}`} onClick={() => del(item)}>
                      <IconTrash size={18} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit pantry item">
        {editing && (
          <form className="form" onSubmit={saveEdit}>
            <PantryFields form={editing.form} setForm={(f) => setEditing({ ...editing, form: f })} idPrefix="edit" />
            {editing.error && (
              <p className="form-error" role="alert">
                {editing.error}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

function WhatCanICook({ pantry }: { pantry: PantryItem[] }) {
  const { recipes } = useRecipes();
  const toast = useToast();
  const [countOptional, setCountOptional] = useState(false);
  const [assumeStaples, setAssumeStaples] = useState(true);
  const [maxMinutes, setMaxMinutes] = useState('');
  const [tag, setTag] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const tags = useMemo(() => collectTags(recipes), [recipes]);

  const matches = useMemo(() => {
    const pool = recipes.filter(
      (r) =>
        (!maxMinutes || totalMinutes(r) <= Number(maxMinutes)) &&
        (!tag || r.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) &&
        (!difficulty || r.difficulty === difficulty) &&
        (!favoritesOnly || r.favorite),
    );
    return matchRecipes(pool, pantry, { countOptional, assumeStaples, today: toIsoDate(new Date()) });
  }, [recipes, pantry, countOptional, assumeStaples, maxMinutes, tag, difficulty, favoritesOnly]);

  const addMissing = async (m: RecipeMatch) => {
    const indexes = m.items.map((it, i) => (it.status === 'missing' ? i : -1)).filter((i) => i >= 0);
    try {
      const r = await api.shopping.fromRecipe(m.recipe.id, m.recipe.servings, false, indexes);
      toast(`Added ${r.added + r.merged} missing ingredient${r.added + r.merged === 1 ? '' : 's'} to your shopping list.`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const activePantry = pantry.filter((p) => !p.usedUp).length;

  return (
    <>
      <section className="card match-options" aria-label="Matching options">
        <div className="field-row">
          <label className="field">
            <span className="label">Max total time</span>
            <select value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)}>
              <option value="">Any</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">1 hour</option>
            </select>
          </label>
          <label className="field">
            <span className="label">Category</span>
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
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
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="">Any</option>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {capitalize(d)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="check-group">
          <label className="check-inline">
            <input type="checkbox" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} /> Favorites only
          </label>
          <label className="check-inline">
            <input type="checkbox" checked={assumeStaples} onChange={(e) => setAssumeStaples(e.target.checked)} /> Assume I have pantry staples (salt, oil…)
          </label>
          <label className="check-inline">
            <input type="checkbox" checked={countOptional} onChange={(e) => setCountOptional(e.target.checked)} /> Count optional ingredients as missing
          </label>
        </div>
        <p className="hint">
          Matching compares ingredient names exactly (ignoring case, plurals and a few common synonyms like scallion → green onion). “Salt” doesn’t match
          “garlic salt”, and quantities are only compared when units are the same.
        </p>
      </section>

      {activePantry === 0 ? (
        <EmptyState title="Add pantry items first">
          <p>Switch to the Inventory tab and add what you have.</p>
        </EmptyState>
      ) : matches.length === 0 ? (
        <EmptyState title="No recipes match these filters" />
      ) : (
        <ul className="match-list">
          {matches.map((m) => {
            const have = m.items.filter((i) => i.status === 'have' || i.status === 'assumed-staple');
            const missing = m.items.filter((i) => i.status === 'missing');
            const optional = m.items.filter((i) => i.status === 'optional-missing');
            return (
              <li key={m.recipe.id} className={`match-card verdict-${m.verdict}`}>
                <div className="match-head">
                  <div>
                    <h3>
                      <Link to={`/recipes/${m.recipe.id}`}>{m.recipe.title}</Link>
                    </h3>
                    <p className="muted small">
                      {formatMinutes(totalMinutes(m.recipe))} · {capitalize(m.recipe.difficulty)}
                    </p>
                  </div>
                  <span className={`verdict verdict-${m.verdict}`}>
                    {m.verdict === 'ready' ? 'Ready to cook' : m.verdict === 'almost' ? 'Almost there' : 'Needs shopping'}
                  </span>
                </div>
                <p>{m.summary}</p>
                <details>
                  <summary>Show how this was matched</summary>
                  <div className="match-detail">
                    <div>
                      <h4>You have ({have.length})</h4>
                      <ul>
                        {have.map((it, i) => (
                          <li key={i}>
                            {it.ingredient.name}
                            {it.status === 'have' && it.pantryItem.name.toLowerCase() !== it.ingredient.name.toLowerCase() && (
                              <span className="muted"> — matched “{it.pantryItem.name}”</span>
                            )}
                            {it.status === 'assumed-staple' && <span className="muted"> — assumed staple</span>}
                            {it.status === 'have' && it.warnings.length > 0 && <span className="badge badge-warn">{it.warnings.join('; ')}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4>Missing ({missing.length})</h4>
                      {missing.length === 0 ? (
                        <p className="muted small">Nothing required.</p>
                      ) : (
                        <ul>
                          {missing.map((it, i) => (
                            <li key={i}>{describeIngredient(it.ingredient)}</li>
                          ))}
                        </ul>
                      )}
                      {optional.length > 0 && (
                        <>
                          <h4>Optional, not in pantry</h4>
                          <ul>
                            {optional.map((it, i) => (
                              <li key={i}>{it.ingredient.name}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  </div>
                </details>
                {missing.length > 0 && (
                  <button type="button" className="btn btn-ghost small" onClick={() => addMissing(m)}>
                    <IconCart size={16} /> Add missing to shopping list
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted small">Nothing is deducted from your pantry automatically — use “Mark used” in the Inventory when you finish something.</p>
    </>
  );
}

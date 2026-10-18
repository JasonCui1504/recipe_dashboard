import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatQuantity, parseQuantity } from '../../shared/quantity';
import type { ShoppingItem } from '../../shared/schema';
import { CATEGORY_ORDER, groupByCategory } from '../../shared/shopping';
import { api, errorMessage } from '../api';
import { EmptyState, ErrorState, Loading, Modal, PageHeader } from '../components/common';
import { IconCalendar, IconEdit, IconPlus, IconTrash } from '../components/Icons';
import { useConfirm, useDocumentTitle, useLoader, useToast } from '../state';

interface ItemForm {
  name: string;
  quantity: string;
  unit: string;
  category: string;
}

function readForm(f: ItemForm): { value?: { name: string; quantity: number | null; unit: string; category: string }; error?: string } {
  if (!f.name.trim()) return { error: 'Enter an item name.' };
  let quantity: number | null = null;
  if (f.quantity.trim()) {
    quantity = parseQuantity(f.quantity);
    if (quantity === null) return { error: `Couldn’t read the quantity “${f.quantity}”.` };
  }
  return { value: { name: f.name.trim(), quantity, unit: f.unit.trim(), category: f.category } };
}

function sourceLabel(item: ShoppingItem): string {
  const labels = [...new Set(item.sources.map((s) => (s.kind === 'manual' ? 'added by you' : s.label)))];
  return labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2} more` : labels.join(', ');
}

export function Shopping() {
  useDocumentTitle('Shopping List');
  const list = useLoader(() => api.shopping.list(), []);
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<ItemForm>({ name: '', quantity: '', unit: '', category: '' });
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item: ShoppingItem; form: ItemForm; error: string | null } | null>(null);

  const items = list.data ?? [];
  const open = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { value, error: err } = readForm(form);
    if (!value) return setError(err ?? null);
    try {
      const r = await api.shopping.add(value);
      setForm({ name: '', quantity: '', unit: '', category: form.category });
      setError(null);
      if (r.merged) toast(`Combined with ${value.name} already on your list.`, 'info');
      list.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const save = async (item: ShoppingItem, patch: Partial<ShoppingItem>) => {
    const next = { ...item, ...patch };
    list.setData((all) => all.map((i) => (i.id === item.id ? next : i)));
    try {
      const updated = await api.shopping.update(item.id, {
        name: next.name,
        quantity: next.quantity,
        unit: next.unit,
        category: next.category,
        checked: next.checked,
      });
      list.setData((all) => all.map((i) => (i.id === item.id ? updated : i)));
      return true;
    } catch (err) {
      list.setData((all) => all.map((i) => (i.id === item.id ? item : i)));
      toast(errorMessage(err), 'error');
      return false;
    }
  };

  const remove = async (item: ShoppingItem) => {
    try {
      await api.shopping.remove(item.id);
      list.setData((all) => all.filter((i) => i.id !== item.id));
      toast(`Removed ${item.name}.`, 'info');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const clearDone = async () => {
    const ok = await confirm({
      title: 'Clear completed items?',
      message: <p>{done.length} checked-off item{done.length === 1 ? '' : 's'} will be removed from your list.</p>,
      confirmLabel: 'Clear completed',
      danger: true,
    });
    if (!ok) return;
    try {
      const { removed } = await api.shopping.clearChecked();
      list.setData((all) => all.filter((i) => !i.checked));
      toast(`Cleared ${removed} item${removed === 1 ? '' : 's'}.`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const { value, error: err } = readForm(editing.form);
    if (!value) return setEditing({ ...editing, error: err ?? null });
    if (await save(editing.item, value)) setEditing(null);
  };

  const row = (item: ShoppingItem) => (
    <li key={item.id} className={`item-row shopping-row ${item.checked ? 'is-checked' : ''}`}>
      <label className="shopping-check">
        <input type="checkbox" checked={item.checked} onChange={(e) => save(item, { checked: e.target.checked })} />
        <span className="item-main">
          <span className="item-name">{item.name}</span>
          {(item.quantity !== null || item.unit) && (
            <span className="item-qty">
              {formatQuantity(item.quantity)} {item.unit}
            </span>
          )}
          <span className="muted small item-source">{sourceLabel(item)}</span>
        </span>
      </label>
      <div className="item-actions">
        <button
          type="button"
          className="icon-btn"
          aria-label={`Edit ${item.name}`}
          onClick={() =>
            setEditing({ item, error: null, form: { name: item.name, quantity: formatQuantity(item.quantity), unit: item.unit, category: item.category } })
          }
        >
          <IconEdit size={18} />
        </button>
        <button type="button" className="icon-btn" aria-label={`Remove ${item.name}`} onClick={() => remove(item)}>
          <IconTrash size={18} />
        </button>
      </div>
    </li>
  );

  const categorySelect = (value: string, onChange: (v: string) => void, id: string) => (
    <label className="field" htmlFor={id}>
      <span className="label">Aisle</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Auto</option>
        {CATEGORY_ORDER.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="page">
      <PageHeader title="Shopping List" kicker={`${open.length} to buy${done.length ? ` · ${done.length} in the basket` : ''}`}>
        <Link className="btn btn-primary" to="/shopping/plan">
          <IconCalendar size={18} /> Plan groceries for a week
        </Link>
      </PageHeader>

      <form className="card form add-form" onSubmit={add} aria-labelledby="add-item-title">
        <h2 id="add-item-title" className="section-title small-title">
          Add an item
        </h2>
        <div className="pantry-fields">
          <label className="field field-grow">
            <span className="label">Item *</span>
            <input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. lemons" />
          </label>
          <label className="field field-qty">
            <span className="label">Quantity</span>
            <input value={form.quantity} inputMode="decimal" onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </label>
          <label className="field field-unit">
            <span className="label">Unit</span>
            <input value={form.unit} maxLength={30} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </label>
          {categorySelect(form.category, (v) => setForm({ ...form, category: v }), 'add-category')}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button type="submit" className="btn btn-primary">
            <IconPlus size={18} /> Add to list
          </button>
        </div>
      </form>

      {list.loading && !list.data ? (
        <Loading />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <EmptyState title="Your shopping list is empty">
          <p>
            Add items above, use “Add Ingredients to Shopping List” on a recipe, or plan meals in the <Link to="/planner">Meal Planner</Link>.
          </p>
        </EmptyState>
      ) : (
        <>
          {open.length === 0 && <p className="muted">Everything is checked off. Nice work!</p>}
          {groupByCategory(open).map(([category, group]) => (
            <section key={category} className="section" aria-label={category}>
              <h2 className="group-title">{category}</h2>
              <ul className="item-list">{group.map(row)}</ul>
            </section>
          ))}
          {done.length > 0 && (
            <section className="section" aria-labelledby="done-title">
              <div className="section-head">
                <h2 id="done-title" className="group-title">
                  In the basket ({done.length})
                </h2>
                <button type="button" className="btn btn-ghost btn-danger-text small" onClick={clearDone}>
                  Clear completed
                </button>
              </div>
              <ul className="item-list">{done.map(row)}</ul>
            </section>
          )}
          <p className="muted small">
            Items are only combined when the name and unit match exactly — “1 cup rice” and “200 g rice” stay separate so nothing gets mis-added.
          </p>
        </>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit item">
        {editing && (
          <form className="form" onSubmit={saveEdit}>
            <div className="pantry-fields">
              <label className="field field-grow">
                <span className="label">Item</span>
                <input value={editing.form.name} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} />
              </label>
              <label className="field field-qty">
                <span className="label">Quantity</span>
                <input value={editing.form.quantity} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, quantity: e.target.value } })} />
              </label>
              <label className="field field-unit">
                <span className="label">Unit</span>
                <input value={editing.form.unit} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, unit: e.target.value } })} />
              </label>
              {categorySelect(editing.form.category, (v) => setEditing({ ...editing, form: { ...editing.form, category: v } }), 'edit-category')}
            </div>
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
    </div>
  );
}

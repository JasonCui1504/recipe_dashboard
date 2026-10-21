import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { guessCategory } from '../../shared/ingredients';
import { formatQuantity, parseQuantity } from '../../shared/quantity';
import type { PantryItem, ShoppingItem, Store } from '../../shared/schema';
import { CATEGORY_ORDER, groupByCategory, planPantryRestock } from '../../shared/shopping';
import { api, ApiError, errorMessage } from '../api';
import { EmptyState, ErrorState, Loading, Modal, PageHeader } from '../components/common';
import { IconCalendar, IconCart, IconEdit, IconPlus, IconTrash } from '../components/Icons';
import { useBasketToPantry, useConfirm, useDocumentTitle, useLoader, useToast } from '../state';

/** Store choice in the add form: a store id, '' (any store) or AUTO (where you usually buy it). */
const AUTO = '__auto';
const ANY_TAB = 'any';

interface ItemForm {
  name: string;
  quantity: string;
  unit: string;
  category: string;
  store: string;
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

/** What checking an item off did to the pantry, so unchecking it can undo exactly that. */
type PantryEffect = { action: 'created'; pantryId: string } | { action: 'restocked'; item: PantryItem };

function pantryInput(item: PantryItem) {
  const { id: _i, createdAt: _c, updatedAt: _u, ...input } = item;
  return input;
}

const categoryRank = (c: string) => {
  const i = CATEGORY_ORDER.indexOf(c || 'Other');
  return i === -1 ? CATEGORY_ORDER.length : i;
};

export function Shopping() {
  const list = useLoader(() => api.shopping.list(), []);
  const storesLoader = useLoader(() => api.stores.list(), []);
  const stores = storesLoader.data ?? [];
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const tab = params.get('store') ?? '';
  const tabStore = stores.find((s) => s.id === tab) ?? null;
  useDocumentTitle(tabStore ? `${tabStore.name} list` : 'Shopping List');

  const defaultStoreChoice = tabStore ? tabStore.id : tab === ANY_TAB ? '' : AUTO;
  const [form, setForm] = useState<ItemForm>({ name: '', quantity: '', unit: '', category: '', store: defaultStoreChoice });
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item: ShoppingItem; form: ItemForm; error: string | null } | null>(null);
  const [managing, setManaging] = useState(false);
  const [toPantry, setToPantry] = useBasketToPantry();
  const pantryEffects = useRef(new Map<string, PantryEffect>());

  const knownStore = (id: string) => stores.some((s) => s.id === id);
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? 'Any store';
  const inTab = (i: ShoppingItem) => (tab === '' ? true : tab === ANY_TAB ? !knownStore(i.store) : i.store === tab);

  const items = list.data ?? [];
  const shown = items.filter(inTab);
  const open = shown.filter((i) => !i.checked);
  const done = shown.filter((i) => i.checked);
  const openCount = (pred: (i: ShoppingItem) => boolean) => items.filter((i) => !i.checked && pred(i)).length;

  const selectTab = (next: string) => {
    setParams(next ? { store: next } : {}, { replace: true });
    const nextStore = stores.find((s) => s.id === next);
    setForm((f) => ({ ...f, store: nextStore ? nextStore.id : next === ANY_TAB ? '' : AUTO }));
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { value, error: err } = readForm(form);
    if (!value) return setError(err ?? null);
    try {
      const r = await api.shopping.add({ ...value, store: form.store === AUTO ? null : form.store });
      setForm({ name: '', quantity: '', unit: '', category: form.category, store: form.store });
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
        store: next.store,
      });
      list.setData((all) => all.map((i) => (i.id === item.id ? updated : i)));
      return true;
    } catch (err) {
      list.setData((all) => all.map((i) => (i.id === item.id ? item : i)));
      toast(errorMessage(err), 'error');
      return false;
    }
  };

  // Checked off → it's bought, so it goes in the pantry (or comes back from "Finished").
  const stockPantry = async (item: ShoppingItem) => {
    const plan = planPantryRestock(await api.pantry.list(), item.name);
    if (plan.action === 'have') return;
    if (plan.action === 'restock') {
      await api.pantry.update(plan.item.id, { ...pantryInput(plan.item), usedUp: false });
      pantryEffects.current.set(item.id, { action: 'restocked', item: plan.item });
      toast(`${plan.item.name} is back in your pantry.`, 'info');
    } else {
      const created = await api.pantry.create({
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        category: guessCategory(item.name),
        expiresOn: null,
        notes: '',
        usedUp: false,
      });
      pantryEffects.current.set(item.id, { action: 'created', pantryId: created.id });
      toast(`Added ${item.name} to your pantry.`, 'info');
    }
  };

  // Unchecked again → undo what checking it did (only what this page did, this visit).
  const unstockPantry = async (item: ShoppingItem) => {
    const effect = pantryEffects.current.get(item.id);
    if (!effect) return;
    pantryEffects.current.delete(item.id);
    if (effect.action === 'created') {
      await api.pantry.remove(effect.pantryId);
      toast(`Took ${item.name} back out of your pantry.`, 'info');
    } else {
      const current = (await api.pantry.list()).find((p) => p.id === effect.item.id);
      if (current && !current.usedUp) await api.pantry.update(current.id, { ...pantryInput(current), usedUp: true });
      toast(`${effect.item.name} is back on your Finished list.`, 'info');
    }
  };

  const setChecked = async (item: ShoppingItem, checked: boolean) => {
    if (!(await save(item, { checked })) || !toPantry) return;
    try {
      await (checked ? stockPantry(item) : unstockPantry(item));
    } catch (err) {
      toast(`Checked off, but the pantry wasn’t updated: ${errorMessage(err)}`, 'error');
    }
  };

  const moveTo = async (item: ShoppingItem, store: string) => {
    if (await save(item, { store })) {
      toast(store ? `${item.name} → ${storeName(store)}. Next time it goes there automatically.` : `${item.name} can be bought anywhere.`, 'info');
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
    const where = tab === '' ? '' : ` from ${tabStore ? tabStore.name : 'Any store'}`;
    const ok = await confirm({
      title: 'Clear completed items?',
      message: (
        <p>
          {done.length} checked-off item{done.length === 1 ? '' : 's'} will be removed{where}.
        </p>
      ),
      confirmLabel: 'Clear completed',
      danger: true,
    });
    if (!ok) return;
    try {
      if (tab === '') {
        await api.shopping.clearChecked();
      } else {
        for (const item of done) await api.shopping.remove(item.id);
      }
      const ids = new Set(done.map((i) => i.id));
      list.setData((all) => all.filter((i) => !ids.has(i.id)));
      toast(`Cleared ${done.length} item${done.length === 1 ? '' : 's'}.`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
      list.reload();
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const { value, error: err } = readForm(editing.form);
    if (!value) return setEditing({ ...editing, error: err ?? null });
    if (await save(editing.item, { ...value, store: editing.form.store })) setEditing(null);
  };

  const storeSelect = (item: ShoppingItem) => (
    <label className="row-store">
      <span className="visually-hidden">Store for {item.name}</span>
      <select value={knownStore(item.store) ? item.store : ''} onChange={(e) => void moveTo(item, e.target.value)}>
        <option value="">Any store</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );

  const row = (item: ShoppingItem) => (
    <li key={item.id} className={`item-row shopping-row ${item.checked ? 'is-checked' : ''}`}>
      <label className="shopping-check">
        <input type="checkbox" checked={item.checked} onChange={(e) => void setChecked(item, e.target.checked)} />
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
        {stores.length > 0 && storeSelect(item)}
        <button
          type="button"
          className="icon-btn"
          aria-label={`Edit ${item.name}`}
          onClick={() =>
            setEditing({
              item,
              error: null,
              form: { name: item.name, quantity: formatQuantity(item.quantity), unit: item.unit, category: item.category, store: knownStore(item.store) ? item.store : '' },
            })
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

  const storeField = (value: string, onChange: (v: string) => void, id: string, withAuto: boolean) => (
    <label className="field" htmlFor={id}>
      <span className="label">Store</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {withAuto && <option value={AUTO}>Where I usually buy it</option>}
        <option value="">Any store</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );

  // "All" groups by store (then aisle order); a single store's list groups by aisle.
  const openGroups: Array<[string, ShoppingItem[]]> =
    tab === '' && stores.length > 0
      ? [...stores.map((s) => s.id), '']
          .map((id): [string, ShoppingItem[]] => [
            id ? storeName(id) : 'Any store',
            open.filter((i) => (id ? i.store === id : !knownStore(i.store))).sort((a, b) => categoryRank(a.category) - categoryRank(b.category)),
          ])
          .filter(([, g]) => g.length > 0)
      : groupByCategory(open);

  const title = tabStore ? tabStore.name : tab === ANY_TAB ? 'Any store' : 'Shopping List';

  return (
    <div className="page shopping-page">
      <PageHeader title={title} kicker={`${open.length} to buy${done.length ? ` · ${done.length} in the basket` : ''}`}>
        <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>
          Print
        </button>
        <Link className="btn btn-primary no-print" to="/shopping/plan">
          <IconCalendar size={18} /> Plan groceries for a week
        </Link>
      </PageHeader>

      <div className="store-tabs no-print" role="group" aria-label="Lists by store">
        <button type="button" className="chip" aria-pressed={tab === ''} onClick={() => selectTab('')}>
          All <span className="chip-count">{openCount(() => true)}</span>
        </button>
        {stores.map((s) => (
          <button key={s.id} type="button" className="chip" aria-pressed={tab === s.id} onClick={() => selectTab(s.id)}>
            <IconCart size={15} /> {s.name} <span className="chip-count">{openCount((i) => i.store === s.id)}</span>
          </button>
        ))}
        {stores.length > 0 && (
          <button type="button" className="chip" aria-pressed={tab === ANY_TAB} onClick={() => selectTab(ANY_TAB)}>
            Any store <span className="chip-count">{openCount((i) => !knownStore(i.store))}</span>
          </button>
        )}
        <button type="button" className="btn btn-link" onClick={() => setManaging(true)}>
          {stores.length ? 'Manage stores' : '+ Add your stores'}
        </button>
      </div>

      <form className="card form add-form no-print" onSubmit={add} aria-labelledby="add-item-title">
        <h2 id="add-item-title" className="section-title small-title">
          Add an item{tabStore ? ` for ${tabStore.name}` : ''}
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
          {stores.length > 0 && storeField(form.store, (v) => setForm({ ...form, store: v }), 'add-store', true)}
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

      {(list.loading && !list.data) || (storesLoader.loading && !storesLoader.data) ? (
        <Loading />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : shown.length === 0 ? (
        <EmptyState title={tab ? `Nothing on the ${title} list` : 'Your shopping list is empty'}>
          <p>
            {tab
              ? 'Add items above, or pick this store from the store menu next to any item.'
              : 'Add items above, use “Add Ingredients to Shopping List” on a recipe, or plan meals in the '}
            {!tab && <Link to="/planner">Meal Planner</Link>}
            {!tab && '.'}
          </p>
        </EmptyState>
      ) : (
        <>
          {open.length === 0 && <p className="muted">Everything is checked off. Nice work!</p>}
          {openGroups.map(([group, groupItems]) => (
            <section key={group} className="section" aria-label={group}>
              <h2 className="group-title">
                {group} <span className="muted">({groupItems.length})</span>
              </h2>
              <ul className="item-list">{groupItems.map(row)}</ul>
            </section>
          ))}
          {done.length > 0 && (
            <section className="section" aria-labelledby="done-title">
              <div className="section-head">
                <h2 id="done-title" className="group-title">
                  In the basket ({done.length})
                </h2>
                <button type="button" className="btn btn-ghost btn-danger-text small no-print" onClick={clearDone}>
                  Clear completed
                </button>
              </div>
              <ul className="item-list">{done.map(row)}</ul>
            </section>
          )}
          <label className="check-inline no-print">
            <input type="checkbox" checked={toPantry} onChange={(e) => setToPantry(e.target.checked)} /> Add items to my pantry when I check them off
          </label>
          <p className="muted small no-print">
            Ingredients from recipes and meal plans are added by name only, without amounts, and join an item with the same name already on the list.
            Amounts you type combine when the units are compatible (“1 cup + 2 tbsp”). When you move an item to a store, ingredients from recipes and
            meal plans go to that store next time.
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
              {stores.length > 0 && storeField(editing.form.store, (v) => setEditing({ ...editing, form: { ...editing.form, store: v } }), 'edit-store', false)}
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

      <ManageStores
        open={managing}
        onClose={() => setManaging(false)}
        stores={stores}
        setStores={(fn) => storesLoader.setData(fn)}
        onRemoved={(id) => {
          if (tab === id) selectTab('');
          list.reload();
        }}
      />
    </div>
  );
}

function ManageStores({
  open,
  onClose,
  stores,
  setStores,
  onRemoved,
}: {
  open: boolean;
  onClose: () => void;
  stores: Store[];
  setStores: (fn: (s: Store[]) => Store[]) => void;
  onRemoved: (id: string) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Type a store name, like “Trader Joe’s”.');
    try {
      const created = await api.stores.create(name.trim());
      setStores((s) => [...s, created]);
      setName('');
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.details.length ? err.details.join(' ') : errorMessage(err));
    }
  };

  const rename = async (store: Store) => {
    const next = (names[store.id] ?? store.name).trim();
    if (!next || next === store.name) return;
    try {
      const updated = await api.stores.rename(store.id, next);
      setStores((s) => s.map((x) => (x.id === store.id ? updated : x)));
      toast(`Renamed to ${updated.name}.`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const remove = async (store: Store) => {
    const ok = await confirm({
      title: `Remove ${store.name}?`,
      message: <p>Items on the {store.name} list move to “Any store”. Nothing is deleted from your shopping list.</p>,
      confirmLabel: 'Remove store',
      danger: true,
    });
    if (!ok) return;
    try {
      const { itemsMoved } = await api.stores.remove(store.id);
      setStores((s) => s.filter((x) => x.id !== store.id));
      onRemoved(store.id);
      toast(`Removed ${store.name}${itemsMoved ? `; ${itemsMoved} item${itemsMoved === 1 ? '' : 's'} moved to Any store` : ''}.`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Your stores">
      <p className="muted small">Each store gets its own shopping list. Items you assign to a store are remembered for next time.</p>
      {stores.length > 0 && (
        <ul className="store-manage-list">
          {stores.map((s) => (
            <li key={s.id}>
              <label className="field field-grow">
                <span className="visually-hidden">Name of {s.name}</span>
                <input
                  value={names[s.id] ?? s.name}
                  maxLength={40}
                  onChange={(e) => setNames({ ...names, [s.id]: e.target.value })}
                  onBlur={() => void rename(s)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void rename(s);
                    }
                  }}
                />
              </label>
              <button type="button" className="icon-btn" aria-label={`Remove ${s.name}`} onClick={() => remove(s)}>
                <IconTrash size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="store-add-row" onSubmit={add}>
        <label className="field field-grow">
          <span className="visually-hidden">New store name</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Add a store, e.g. Costco" />
        </label>
        <button type="submit" className="btn btn-primary">
          <IconPlus size={18} /> Add
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

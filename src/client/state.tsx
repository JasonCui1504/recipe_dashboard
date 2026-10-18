import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Recipe } from '../shared/schema';
import { api, errorMessage } from './api';

// ---------------------------------------------------------------------------
// Recipes: loaded once and shared by every page.
// ---------------------------------------------------------------------------

interface RecipesState {
  recipes: Recipe[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  upsert: (recipe: Recipe) => void;
  remove: (id: string) => void;
}

const RecipesContext = createContext<RecipesState | null>(null);

export function RecipesProvider({ children }: { children: ReactNode }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRecipes(await api.recipes.list());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const upsert = useCallback((recipe: Recipe) => {
    setRecipes((list) => {
      const i = list.findIndex((r) => r.id === recipe.id);
      if (i === -1) return [...list, recipe];
      const copy = [...list];
      copy[i] = recipe;
      return copy;
    });
  }, []);
  const remove = useCallback((id: string) => setRecipes((list) => list.filter((r) => r.id !== id)), []);

  const value = useMemo(() => ({ recipes, loading, error, reload, upsert, remove }), [recipes, loading, error, reload, upsert, remove]);
  return <RecipesContext.Provider value={value}>{children}</RecipesContext.Provider>;
}

export function useRecipes(): RecipesState {
  const ctx = useContext(RecipesContext);
  if (!ctx) throw new Error('useRecipes must be used inside RecipesProvider');
  return ctx;
}

/** Toggles a favorite optimistically and keeps the shared list in sync. */
export function useToggleFavorite() {
  const { upsert } = useRecipes();
  const toast = useToast();
  return useCallback(
    async (recipe: Recipe) => {
      upsert({ ...recipe, favorite: !recipe.favorite });
      try {
        upsert(await api.recipes.favorite(recipe.id, !recipe.favorite));
      } catch (err) {
        upsert(recipe);
        toast(errorMessage(err), 'error');
      }
    },
    [upsert, toast],
  );
}

// ---------------------------------------------------------------------------
// Toasts: short status messages announced to screen readers.
// ---------------------------------------------------------------------------

type ToastTone = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}
type ToastFn = (message: string, tone?: ToastTone) => void;
const ToastContext = createContext<ToastFn | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback<ToastFn>(
    (message, tone = 'info') => {
      const id = next.current++;
      setToasts((t) => [...t.slice(-3), { id, message, tone }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.message}</span>
            <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss message">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Confirmation dialog: `await confirm({...})` resolves true/false.
// ---------------------------------------------------------------------------

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...opts, resolve });
      }),
    [],
  );

  useEffect(() => {
    const d = dialogRef.current;
    if (pending && d && !d.open) d.showModal();
  }, [pending]);

  const finish = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
    dialogRef.current?.close();
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialogRef}
        className="dialog dialog-small"
        aria-labelledby="confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          finish(false);
        }}
      >
        {pending && (
          <div className="dialog-body">
            <h2 id="confirm-title" className="dialog-title">
              {pending.title}
            </h2>
            <div className="dialog-message">{pending.message}</div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => finish(false)} autoFocus>
                {pending.cancelLabel ?? 'Cancel'}
              </button>
              <button type="button" className={`btn ${pending.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => finish(true)}>
                {pending.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · The Cookbook` : 'The Cookbook';
  }, [title]);
}

/** Loads data with loading/error state. `reload` re-runs the loader. */
export function useLoader<T>(loader: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: true,
    error: null,
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    loader().then(
      (data) => !cancelled && setState({ data, loading: false, error: null }),
      (err) => !cancelled && setState({ data: null, loading: false, error: errorMessage(err) }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((fn: (d: T) => T) => setState((s) => (s.data === null ? s : { ...s, data: fn(s.data) })), []);
  return { ...state, reload, setData };
}

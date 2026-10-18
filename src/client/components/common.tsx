import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Recipe } from '../../shared/schema';
import { totalMinutes } from '../../shared/search';
import { useToggleFavorite } from '../state';
import { IconClock, IconClose, IconHeart } from './Icons';
import { RecipeArt } from './RecipeArt';

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function FavoriteButton({ recipe, className = '' }: { recipe: Recipe; className?: string }) {
  const toggle = useToggleFavorite();
  return (
    <button
      type="button"
      className={`icon-btn fav-btn ${recipe.favorite ? 'is-fav' : ''} ${className}`}
      aria-pressed={recipe.favorite}
      aria-label={recipe.favorite ? `Remove ${recipe.title} from favorites` : `Add ${recipe.title} to favorites`}
      onClick={(e) => {
        e.preventDefault();
        void toggle(recipe);
      }}
    >
      <IconHeart filled={recipe.favorite} />
    </button>
  );
}

export function RecipeCard({ recipe, extra }: { recipe: Recipe; extra?: ReactNode }) {
  return (
    <article className="recipe-card">
      <Link to={`/recipes/${recipe.id}`} className="recipe-card-link">
        <div className="recipe-card-art">
          <RecipeArt recipe={recipe} />
        </div>
        <div className="recipe-card-body">
          <h3 className="recipe-card-title">{recipe.title}</h3>
          <p className="recipe-card-meta">
            <span>
              <IconClock size={15} /> {formatMinutes(totalMinutes(recipe))}
            </span>
            <span aria-hidden="true">·</span>
            <span>{capitalize(recipe.difficulty)}</span>
          </p>
          {recipe.tags.length > 0 && (
            <ul className="tag-row" aria-label="Categories">
              {recipe.tags.slice(0, 3).map((t) => (
                <li key={t} className="tag">
                  {t}
                </li>
              ))}
            </ul>
          )}
          {extra}
        </div>
      </Link>
      <FavoriteButton recipe={recipe} className="recipe-card-fav" />
    </article>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state state-loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, art = true }: { title: string; children?: ReactNode; art?: boolean }) {
  return (
    <div className="empty">
      {art && (
        <svg className="empty-art" viewBox="0 0 120 80" aria-hidden="true">
          <ellipse cx="60" cy="56" rx="44" ry="10" fill="var(--accent-dim)" />
          <path d="M22 44h76a38 26 0 0 1-76 0z" fill="var(--lift)" stroke="var(--subtle)" strokeWidth="2" />
          <path d="M48 30c0-6 6-6 6-12M62 30c0-6 6-6 6-12" stroke="var(--accent)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </svg>
      )}
      <h3 className="empty-title">{title}</h3>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

/** Modal built on the native <dialog> element (focus trapping + Esc for free). */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'dialog-wide' : ''}`}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <div className="dialog-body">
          <div className="dialog-head">
            <h2 id="modal-title" className="dialog-title">
              {title}
            </h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <IconClose />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function FieldErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="form-errors" role="alert">
      <p>Please fix the following:</p>
      <ul>
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

export function PageHeader({ title, kicker, children }: { title: string; kicker?: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {kicker && <p className="kicker">{kicker}</p>}
        <h1 className="page-title">{title}</h1>
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </header>
  );
}

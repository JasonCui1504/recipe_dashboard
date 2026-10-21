import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import type { Recipe } from '../../shared/schema';
import { api, errorMessage } from '../api';
import { useLoader, useRecipes, useToast } from '../state';
import { IconClose, IconSpark } from './Icons';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const QUESTION_MAX = 1000;
const NOTES_MAX = 4000;

/** Which recipe (if any) the current page is about: /recipes/:id, /recipes/:id/edit or /recipes/:id/cook. */
function recipeIdFromPath(path: string): string | null {
  const m = /^\/recipes\/([^/]+)(?:\/(?:edit|cook))?\/?$/.exec(path);
  return m && m[1] !== 'new' ? decodeURIComponent(m[1]) : null;
}

function pageLabel(path: string, recipe: Recipe | undefined): string {
  if (recipe) return recipe.title;
  if (path === '/') return 'Discover';
  if (path === '/recipes/new') return 'New recipe';
  if (path.startsWith('/recipes')) return 'My Recipes';
  if (path.startsWith('/planner')) return 'Meal Planner';
  if (path.startsWith('/shopping')) return 'Shopping List';
  if (path.startsWith('/pantry')) return 'Pantry';
  if (path.startsWith('/insights')) return 'Insights';
  if (path.startsWith('/settings')) return 'Settings';
  return 'The Cookbook';
}

function suggestions(path: string, recipe: Recipe | undefined): string[] {
  if (recipe) {
    return [
      `How would I make this spicier?`,
      `Can I make ${recipe.title} ahead of time?`,
      `What could I add to make it more filling?`,
      `How do I adapt it for ${recipe.servings * 2} people?`,
    ];
  }
  if (path.startsWith('/pantry')) return ['What can I make with what I have?', 'How long do cooked leftovers keep in the fridge?'];
  if (path.startsWith('/shopping')) return ['Anything I might be forgetting for this list?', 'How do I pick ripe avocados?'];
  if (path.startsWith('/planner') || path === '/') return ['Which of this week’s meals can I prep on Sunday?', 'Ideas for an easy breakfast this week?'];
  return ['How do I keep herbs fresh longer?', 'What’s a good substitute for buttermilk?'];
}

/**
 * A floating "Ask" helper on every page. It sends your question to the local
 * model together with what the page is about (the recipe you're viewing, or
 * your pantry, list or plan), and answers in plain text. It never changes
 * anything itself; on a recipe you can copy an answer into your notes.
 */
export function Assistant() {
  const location = useLocation();
  const [params] = useSearchParams();
  const { recipes, upsert } = useRecipes();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ai = useLoader(() => (open ? api.ai.settings() : Promise.resolve(null)), [open]);
  const path = location.pathname;
  const recipeId = recipeIdFromPath(path);
  const recipe = recipeId ? recipes.find((r) => r.id === recipeId) : undefined;
  const servings = Number(params.get('servings')) || undefined;
  // One conversation per recipe, and one per page otherwise.
  const key = recipeId ? `recipe:${recipeId}` : `page:${path.split('/')[1] ?? ''}`;
  const [chats, setChats] = useState<Record<string, Turn[]>>({});
  const turns = useMemo(() => chats[key] ?? [], [chats, key]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<{ key: string; question: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns.length, pending, open]);
  useEffect(() => setError(null), [key]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    const askedKey = key;
    setPending({ key: askedKey, question: q });
    setError(null);
    setText('');
    try {
      const history = (chats[askedKey] ?? []).slice(-8);
      const { answer } = await api.ai.ask(q, history, { path, recipeId: recipeId ?? undefined, servings });
      setChats((c) => ({ ...c, [askedKey]: [...(c[askedKey] ?? []), { role: 'user', content: q }, { role: 'assistant', content: answer }] }));
    } catch (err) {
      setError(errorMessage(err));
      setText((t) => t || q);
    } finally {
      setPending(null);
    }
  };

  const addToNotes = async (answer: string, id: string) => {
    if (!recipe) return;
    const notes = recipe.notes ? `${recipe.notes}\n\n${answer}` : answer;
    if (notes.length > NOTES_MAX) return toast('That would make your notes too long. Copy the part you need instead.', 'error');
    const { id: _i, createdAt: _c, updatedAt: _u, ...input } = recipe;
    try {
      upsert(await api.recipes.update(recipe.id, { ...input, notes }));
      setSaved((s) => new Set(s).add(id));
      toast(`Added to your notes for ${recipe.title}.`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const canSaveNotes = recipe !== undefined && !path.endsWith('/edit');
  const thinking = pending?.key === key;

  if (!open) {
    return (
      <button type="button" className="assistant-fab no-print" onClick={() => setOpen(true)} aria-label="Ask the kitchen assistant" title="Ask the kitchen assistant">
        <IconSpark size={18} />
        <span>Ask</span>
      </button>
    );
  }

  return (
    <section
      className="assistant-panel no-print"
      role="dialog"
      aria-label="Kitchen assistant"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <header className="assistant-head">
        <div>
          <h2 className="assistant-title">
            <IconSpark size={16} /> Kitchen assistant
          </h2>
          <p className="assistant-about muted small">About: {pageLabel(path, recipe)}</p>
        </div>
        {turns.length > 0 && (
          <button type="button" className="btn btn-link small" onClick={() => setChats((c) => ({ ...c, [key]: [] }))}>
            New chat
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close the assistant">
          <IconClose />
        </button>
      </header>

      {ai.loading && !ai.data ? (
        <p className="muted small assistant-body">Loading…</p>
      ) : ai.data && !ai.data.enabled ? (
        <div className="assistant-body">
          <p>The assistant uses your local AI model, which is turned off.</p>
          <p className="small">
            Turn it on in <Link to="/settings" onClick={() => setOpen(false)}>Settings → Local AI assistant</Link>.
          </p>
        </div>
      ) : (
        <>
          <div className="assistant-body" aria-live="polite">
            {turns.length === 0 && !thinking && (
              <>
                <p className="muted small">
                  {recipe
                    ? 'Ask anything about this recipe: changes, swaps, timing, making it ahead…'
                    : 'Ask a cooking question. The assistant can see what’s on this page.'}
                </p>
                <div className="assistant-suggestions">
                  {suggestions(path, recipe).map((s) => (
                    <button key={s} type="button" className="chip" onClick={() => void ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
            {turns.map((t, i) => {
              const id = `${key}:${i}`;
              return t.role === 'user' ? (
                <p key={id} className="assistant-msg from-user">
                  {t.content}
                </p>
              ) : (
                <div key={id} className="assistant-msg from-ai">
                  <p>{t.content}</p>
                  {canSaveNotes && (
                    <button type="button" className="btn btn-link small" disabled={saved.has(id)} onClick={() => void addToNotes(t.content, id)}>
                      {saved.has(id) ? 'Added to notes' : 'Add to my notes'}
                    </button>
                  )}
                </div>
              );
            })}
            {thinking && (
              <>
                <p className="assistant-msg from-user">{pending.question}</p>
                <p className="assistant-msg from-ai assistant-thinking">Thinking… (this can take a few seconds)</p>
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>
          <form
            className="assistant-form"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(text);
            }}
          >
            <label className="visually-hidden" htmlFor="assistant-input">
              Your question
            </label>
            <textarea
              id="assistant-input"
              ref={inputRef}
              rows={2}
              maxLength={QUESTION_MAX}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(text);
                }
              }}
              placeholder={recipe ? 'e.g. I want to add mushrooms. When and how?' : 'Ask a cooking question…'}
            />
            <button type="submit" className="btn btn-primary" disabled={!text.trim() || pending !== null}>
              Ask
            </button>
          </form>
          <p className="assistant-disclaimer">Answers come from your local model and can be wrong. Nothing changes unless you choose to.</p>
        </>
      )}
    </section>
  );
}

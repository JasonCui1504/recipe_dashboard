import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { parseIngredientLine } from '../../shared/parse';
import { formatQuantity, parseQuantity } from '../../shared/quantity';
import { AI_DRAFT_REQUEST_MAX, DIFFICULTIES, describeZodError, emptyRecipeInput, recipeInputSchema, type Recipe, type RecipeInput } from '../../shared/schema';
import { api, ApiError, errorMessage } from '../api';
import { capitalize, EmptyState, ErrorState, FieldErrors, Loading, PageHeader } from '../components/common';
import { IconChevronLeft, IconClose, IconPlus, IconSpark } from '../components/Icons';
import { RecipeArt } from '../components/RecipeArt';
import { useConfirm, useDocumentTitle, useLoader, useRecipes, useToast } from '../state';

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

interface IngredientRow {
  key: string;
  quantity: string;
  unit: string;
  name: string;
  note: string;
  optional: boolean;
  staple: boolean;
}
interface FormState {
  title: string;
  description: string;
  cuisine: string;
  tags: string;
  dietary: string;
  prepMinutes: string;
  cookMinutes: string;
  servings: string;
  difficulty: RecipeInput['difficulty'];
  favorite: boolean;
  rating: string;
  imagePath: string | null;
  sourceNote: string;
  notes: string;
  ingredients: IngredientRow[];
  steps: Array<{ key: string; text: string }>;
  nutritionOn: boolean;
  nutrition: { calories: string; protein: string; carbs: string; fat: string; basis: 'user-entered' | 'estimated' };
}

const numText = (n: number | null) => (n === null ? '' : String(n));

function toForm(r: RecipeInput): FormState {
  return {
    title: r.title,
    description: r.description,
    cuisine: r.cuisine,
    tags: r.tags.join(', '),
    dietary: r.dietary.join(', '),
    prepMinutes: String(r.prepMinutes),
    cookMinutes: String(r.cookMinutes),
    servings: String(r.servings),
    difficulty: r.difficulty,
    favorite: r.favorite,
    rating: numText(r.rating),
    imagePath: r.imagePath,
    sourceNote: r.sourceNote,
    notes: r.notes,
    ingredients: r.ingredients.map((i) => ({ ...i, key: nextKey(), quantity: i.quantity === null ? '' : formatQuantity(i.quantity) })),
    steps: r.steps.map((text) => ({ key: nextKey(), text })),
    nutritionOn: r.nutrition !== null,
    nutrition: {
      calories: numText(r.nutrition?.calories ?? null),
      protein: numText(r.nutrition?.protein ?? null),
      carbs: numText(r.nutrition?.carbs ?? null),
      fat: numText(r.nutrition?.fat ?? null),
      basis: r.nutrition?.basis ?? 'user-entered',
    },
  };
}

const splitList = (s: string) => [...new Set(s.split(',').map((t) => t.trim()).filter(Boolean))];

function fromForm(f: FormState): { input: RecipeInput | null; errors: string[] } {
  const errors: string[] = [];
  const int = (label: string, s: string, min: number) => {
    const n = Number(s);
    if (s.trim() === '' || !Number.isInteger(n) || n < min) {
      errors.push(`${label} must be a whole number${min > 0 ? ` of at least ${min}` : ''}.`);
      return min;
    }
    return n;
  };
  const optNum = (label: string, s: string) => {
    if (s.trim() === '') return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) {
      errors.push(`${label} must be a positive number.`);
      return null;
    }
    return n;
  };

  const ingredients = f.ingredients
    .filter((i) => i.name.trim() || i.quantity.trim() || i.unit.trim())
    .map((i, idx) => {
      let quantity: number | null = null;
      if (i.quantity.trim()) {
        quantity = parseQuantity(i.quantity);
        if (quantity === null) {
          errors.push(`Ingredient ${idx + 1}: couldn’t read the amount “${i.quantity}”. Use a number like 2, 1.5 or 1 1/2, or put it in the note.`);
        }
      }
      if (!i.name.trim()) errors.push(`Ingredient ${idx + 1}: add an ingredient name.`);
      return { quantity, unit: i.unit, name: i.name, note: i.note, optional: i.optional, staple: i.staple };
    });

  const candidate: RecipeInput = {
    title: f.title,
    description: f.description,
    cuisine: f.cuisine,
    tags: splitList(f.tags),
    dietary: splitList(f.dietary),
    prepMinutes: int('Prep time', f.prepMinutes, 0),
    cookMinutes: int('Cook time', f.cookMinutes, 0),
    servings: int('Servings', f.servings, 1),
    difficulty: f.difficulty,
    favorite: f.favorite,
    rating: f.rating ? Number(f.rating) : null,
    imagePath: f.imagePath,
    sourceNote: f.sourceNote,
    notes: f.notes,
    ingredients,
    steps: f.steps.map((s) => s.text.trim()).filter(Boolean),
    nutrition: f.nutritionOn
      ? {
          calories: optNum('Calories', f.nutrition.calories),
          protein: optNum('Protein', f.nutrition.protein),
          carbs: optNum('Carbs', f.nutrition.carbs),
          fat: optNum('Fat', f.nutrition.fat),
          basis: f.nutrition.basis,
        }
      : null,
  };
  if (errors.length) return { input: null, errors };
  const parsed = recipeInputSchema.safeParse(candidate);
  if (!parsed.success) return { input: null, errors: describeZodError(parsed.error) };
  return { input: parsed.data, errors: [] };
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export function RecipeEditorPage() {
  const { id } = useParams();
  const { recipes, loading, error, reload } = useRecipes();
  if (!id) return <RecipeEditor key="new" initial={null} />;
  const recipe = recipes.find((r) => r.id === id);
  if (!recipe) {
    if (loading) return <Loading />;
    if (error) return <ErrorState message={error} onRetry={reload} />;
    return (
      <div className="page">
        <EmptyState title="Recipe not found">
          <Link to="/recipes" className="btn btn-primary">
            Back to My Recipes
          </Link>
        </EmptyState>
      </div>
    );
  }
  return <RecipeEditor key={recipe.id} initial={recipe} />;
}

function RecipeEditor({ initial }: { initial: Recipe | null }) {
  useDocumentTitle(initial ? `Edit ${initial.title}` : 'New recipe');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { upsert } = useRecipes();
  const toast = useToast();
  const confirm = useConfirm();
  const startForm = useMemo(() => toForm(initial ?? emptyRecipeInput()), [initial]);
  const [form, setForm] = useState<FormState>(startForm);
  const baseline = useMemo(() => JSON.stringify(startForm), [startForm]);
  const savedRef = useRef(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [uploading, setUploading] = useState(false);
  const errorsRef = useRef<HTMLDivElement>(null);

  const [aiOpen, setAiOpen] = useState(params.get('ai') === '1' && !initial);
  const ai = useLoader(() => api.ai.settings(), []);
  const [aiRequest, setAiRequest] = useState('');
  const [aiState, setAiState] = useState<{ loading: boolean; error: string | null; drafted: boolean }>({ loading: false, error: null, drafted: false });

  const dirty = !saved && JSON.stringify(form) !== baseline;

  // Never silently lose edits: block in-app navigation and warn on tab close.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => !savedRef.current && dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirm({
      title: 'Discard unsaved changes?',
      message: <p>You have changes to this recipe that haven’t been saved.</p>,
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      danger: true,
    }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker, confirm]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setIng = (i: number, patch: Partial<IngredientRow>) =>
    setForm((f) => ({ ...f, ingredients: f.ingredients.map((row, idx) => (idx === i ? { ...row, ...patch } : row)) }));
  const setStep = (i: number, text: string) => setForm((f) => ({ ...f, steps: f.steps.map((s, idx) => (idx === i ? { ...s, text } : s)) }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const { input, errors: errs } = fromForm(form);
    if (!input) {
      setErrors(errs);
      requestAnimationFrame(() => errorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      const result = initial ? await api.recipes.update(initial.id, input) : await api.recipes.create(input);
      upsert(result);
      savedRef.current = true;
      setSaved(true);
      toast(initial ? 'Recipe saved.' : 'Recipe added to your cookbook.', 'success');
      navigate(`/recipes/${result.id}`);
    } catch (err) {
      setErrors(err instanceof ApiError && err.details.length ? err.details : [errorMessage(err)]);
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('Images must be 5 MB or smaller.', 'error');
    setUploading(true);
    try {
      set('imagePath', await api.images.upload(file));
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setUploading(false);
    }
  };

  const applyPaste = () => {
    const parsed = pasteText.split('\n').map(parseIngredientLine).filter((x): x is NonNullable<typeof x> => x !== null);
    if (parsed.length === 0) return;
    setForm((f) => ({
      ...f,
      ingredients: [
        ...f.ingredients.filter((i) => i.name.trim()),
        ...parsed.map((i) => ({ ...i, key: nextKey(), quantity: i.quantity === null ? '' : formatQuantity(i.quantity) })),
      ],
    }));
    setPasteText('');
    setPasteOpen(false);
  };

  const runDraft = async () => {
    if (dirty && form.title.trim()) {
      const ok = await confirm({
        title: 'Replace the form with an AI draft?',
        message: <p>What you’ve typed so far will be replaced by the draft. Nothing is saved until you press Save.</p>,
        confirmLabel: 'Replace with draft',
      });
      if (!ok) return;
    }
    setAiState({ loading: true, error: null, drafted: false });
    try {
      const { draft } = await api.ai.draft(aiRequest);
      setForm(toForm(draft));
      setAiState({ loading: false, error: null, drafted: true });
    } catch (err) {
      setAiState({ loading: false, error: errorMessage(err), drafted: false });
    }
  };

  const previewRecipe = { id: initial?.id ?? 'new', title: form.title, tags: splitList(form.tags), imagePath: form.imagePath };

  return (
    <div className="page editor-page">
      <Link to={initial ? `/recipes/${initial.id}` : '/recipes'} className="back-link">
        <IconChevronLeft size={18} /> {initial ? 'Back to recipe' : 'My Recipes'}
      </Link>
      <PageHeader title={initial ? 'Edit recipe' : 'New recipe'} kicker={dirty ? 'Unsaved changes' : undefined}>
        {!initial && !aiOpen && (
          <button type="button" className="btn btn-ghost" onClick={() => setAiOpen(true)}>
            <IconSpark size={18} /> Draft with AI
          </button>
        )}
      </PageHeader>

      {aiOpen && (
        <section className="ai-panel" aria-labelledby="ai-title">
          <div className="section-head">
            <h2 id="ai-title" className="section-title small-title">
              <IconSpark size={18} /> Draft with your local AI (optional)
            </h2>
            <button type="button" className="icon-btn" onClick={() => setAiOpen(false)} aria-label="Close AI drafting">
              <IconClose />
            </button>
          </div>
          {ai.loading ? (
            <Loading />
          ) : !ai.data?.enabled ? (
            <p>
              AI drafting is turned off. You can enable a local Ollama model in <Link to="/settings">Settings</Link> — or simply fill in the form below.
            </p>
          ) : (
            <>
              <label className="field">
                <span className="label">Describe the dish</span>
                <textarea
                  rows={5}
                  maxLength={AI_DRAFT_REQUEST_MAX}
                  value={aiRequest}
                  onChange={(e) => setAiRequest(e.target.value)}
                  placeholder={'e.g. a quick weeknight chicken and broccoli stir-fry for 2.\nAdd as much detail as you like: ingredients to use up, cooking method, spice level, dietary needs…'}
                  aria-describedby="ai-request-count"
                />
                <span id="ai-request-count" className="hint">
                  {aiRequest.length} / {AI_DRAFT_REQUEST_MAX} characters
                </span>
              </label>
              <div className="button-row">
                <button type="button" className="btn btn-primary" onClick={runDraft} disabled={aiState.loading || !aiRequest.trim()}>
                  {aiState.loading ? 'Drafting… (this can take a minute)' : 'Generate draft'}
                </button>
              </div>
              {aiState.error && (
                <p className="form-error" role="alert">
                  {aiState.error} You can still write the recipe yourself below.
                </p>
              )}
              {aiState.drafted && (
                <p className="ai-label" role="status">
                  <IconSpark size={16} /> The form below contains an AI draft. It is not saved — check quantities, times and food safety, then press Save
                  if you want to keep it.
                </p>
              )}
            </>
          )}
        </section>
      )}

      <form className="form recipe-form" onSubmit={save} noValidate>
        <div ref={errorsRef}>
          <FieldErrors errors={errors} />
        </div>

        <fieldset className="card">
          <legend>Basics</legend>
          <label className="field">
            <span className="label">Title *</span>
            <input value={form.title} maxLength={140} onChange={(e) => set('title', e.target.value)} required />
          </label>
          <label className="field">
            <span className="label">Short description</span>
            <textarea rows={2} maxLength={600} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          <div className="field-row">
            <label className="field">
              <span className="label">Prep (minutes)</span>
              <input type="number" min={0} inputMode="numeric" value={form.prepMinutes} onChange={(e) => set('prepMinutes', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Cook (minutes)</span>
              <input type="number" min={0} inputMode="numeric" value={form.cookMinutes} onChange={(e) => set('cookMinutes', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Servings *</span>
              <input type="number" min={1} max={100} inputMode="numeric" value={form.servings} onChange={(e) => set('servings', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Difficulty</span>
              <select value={form.difficulty} onChange={(e) => set('difficulty', e.target.value as FormState['difficulty'])}>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {capitalize(d)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="label">Categories / tags</span>
              <input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="dinner, pasta, high-protein" aria-describedby="tags-hint" />
              <span id="tags-hint" className="hint">
                Separate with commas
              </span>
            </label>
            <label className="field">
              <span className="label">Dietary labels</span>
              <input value={form.dietary} onChange={(e) => set('dietary', e.target.value)} placeholder="vegetarian, gluten-free" />
            </label>
            <label className="field">
              <span className="label">Cuisine</span>
              <input value={form.cuisine} maxLength={60} onChange={(e) => set('cuisine', e.target.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset className="card">
          <legend>Photo</legend>
          <div className="photo-row">
            <div className="photo-preview">
              <RecipeArt recipe={previewRecipe} />
            </div>
            <div>
              <p className="muted small">
                Optional. PNG, JPEG or WebP up to 5 MB, stored with your local data. Without a photo the recipe gets an illustration.
              </p>
              <div className="button-row">
                <label className="btn btn-ghost file-btn">
                  {uploading ? 'Uploading…' : form.imagePath ? 'Replace photo' : 'Choose photo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="visually-hidden"
                    onChange={(e) => {
                      void upload(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
                {form.imagePath && (
                  <button type="button" className="btn btn-link" onClick={() => set('imagePath', null)}>
                    Remove photo
                  </button>
                )}
              </div>
            </div>
          </div>
        </fieldset>

        <fieldset className="card">
          <legend>Ingredients *</legend>
          <p className="hint">
            Amounts can be written as 2, 1.5, 1/2 or 1 1/2. Leave the amount blank for things like “salt, to taste”. Mark <em>staples</em> (salt, oil…) so
            pantry matching can assume you have them.
          </p>
          <ol className="ing-editor">
            {form.ingredients.map((row, i) => (
              <li key={row.key} className="ing-row">
                <div className="ing-fields">
                  <label className="field field-qty">
                    <span className="label">Amount</span>
                    <input value={row.quantity} onChange={(e) => setIng(i, { quantity: e.target.value })} inputMode="decimal" />
                  </label>
                  <label className="field field-unit">
                    <span className="label">Unit</span>
                    <input value={row.unit} maxLength={30} onChange={(e) => setIng(i, { unit: e.target.value })} />
                  </label>
                  <label className="field field-grow">
                    <span className="label">Ingredient</span>
                    <input value={row.name} maxLength={120} onChange={(e) => setIng(i, { name: e.target.value })} />
                  </label>
                  <label className="field field-grow">
                    <span className="label">Note</span>
                    <input value={row.note} maxLength={200} onChange={(e) => setIng(i, { note: e.target.value })} placeholder="chopped" />
                  </label>
                </div>
                <div className="ing-flags">
                  <label className="check-inline">
                    <input type="checkbox" checked={row.optional} onChange={(e) => setIng(i, { optional: e.target.checked })} /> Optional
                  </label>
                  <label className="check-inline">
                    <input type="checkbox" checked={row.staple} onChange={(e) => setIng(i, { staple: e.target.checked })} /> Pantry staple
                  </label>
                  <span className="row-tools">
                    <button type="button" className="btn btn-link small" onClick={() => set('ingredients', move(form.ingredients, i, i - 1))} disabled={i === 0} aria-label={`Move ingredient ${i + 1} up`}>
                      ↑
                    </button>
                    <button type="button" className="btn btn-link small" onClick={() => set('ingredients', move(form.ingredients, i, i + 1))} disabled={i === form.ingredients.length - 1} aria-label={`Move ingredient ${i + 1} down`}>
                      ↓
                    </button>
                    <button type="button" className="btn btn-link small btn-danger-text" onClick={() => set('ingredients', form.ingredients.filter((_, idx) => idx !== i))} aria-label={`Remove ingredient ${i + 1}`}>
                      Remove
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ol>
          <div className="button-row">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => set('ingredients', [...form.ingredients, { key: nextKey(), quantity: '', unit: '', name: '', note: '', optional: false, staple: false }])}
            >
              <IconPlus size={18} /> Add ingredient
            </button>
            <button type="button" className="btn btn-link" onClick={() => setPasteOpen((o) => !o)} aria-expanded={pasteOpen}>
              Paste a list
            </button>
          </div>
          {pasteOpen && (
            <div className="paste-box">
              <label className="field">
                <span className="label">One ingredient per line</span>
                <textarea rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'2 cups rice, rinsed\n1 1/2 tbsp soy sauce\nsalt, to taste'} />
              </label>
              <button type="button" className="btn btn-primary" onClick={applyPaste}>
                Add these ingredients
              </button>
            </div>
          )}
        </fieldset>

        <fieldset className="card">
          <legend>Steps *</legend>
          <ol className="step-editor">
            {form.steps.map((s, i) => (
              <li key={s.key}>
                <label className="field">
                  <span className="label">Step {i + 1}</span>
                  <textarea rows={2} value={s.text} maxLength={2000} onChange={(e) => setStep(i, e.target.value)} />
                </label>
                <span className="row-tools">
                  <button type="button" className="btn btn-link small" onClick={() => set('steps', move(form.steps, i, i - 1))} disabled={i === 0} aria-label={`Move step ${i + 1} up`}>
                    ↑
                  </button>
                  <button type="button" className="btn btn-link small" onClick={() => set('steps', move(form.steps, i, i + 1))} disabled={i === form.steps.length - 1} aria-label={`Move step ${i + 1} down`}>
                    ↓
                  </button>
                  <button type="button" className="btn btn-link small btn-danger-text" onClick={() => set('steps', form.steps.filter((_, idx) => idx !== i))} aria-label={`Remove step ${i + 1}`}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-ghost" onClick={() => set('steps', [...form.steps, { key: nextKey(), text: '' }])}>
            <IconPlus size={18} /> Add step
          </button>
        </fieldset>

        <fieldset className="card">
          <legend>Notes &amp; extras</legend>
          <label className="field">
            <span className="label">Your notes and adjustments</span>
            <textarea rows={3} maxLength={4000} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Less chili next time; doubles well." />
          </label>
          <div className="field-row">
            <label className="field field-grow">
              <span className="label">Source / attribution</span>
              <input value={form.sourceNote} maxLength={300} onChange={(e) => set('sourceNote', e.target.value)} placeholder="Grandma’s recipe card" />
            </label>
            <label className="field">
              <span className="label">Your rating</span>
              <select value={form.rating} onChange={(e) => set('rating', e.target.value)}>
                <option value="">Not rated</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {'★'.repeat(n)} ({n})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check-inline">
            <input type="checkbox" checked={form.favorite} onChange={(e) => set('favorite', e.target.checked)} /> Favorite
          </label>
          <label className="check-inline">
            <input type="checkbox" checked={form.nutritionOn} onChange={(e) => set('nutritionOn', e.target.checked)} /> Add nutrition per serving
          </label>
          {form.nutritionOn && (
            <div className="nutrition-editor">
              <div className="field-row">
                {(['calories', 'protein', 'carbs', 'fat'] as const).map((k) => (
                  <label key={k} className="field">
                    <span className="label">
                      {capitalize(k)} {k === 'calories' ? '(kcal)' : '(g)'}
                    </span>
                    <input type="number" min={0} inputMode="decimal" value={form.nutrition[k]} onChange={(e) => set('nutrition', { ...form.nutrition, [k]: e.target.value })} />
                  </label>
                ))}
                <label className="field">
                  <span className="label">These numbers are</span>
                  <select value={form.nutrition.basis} onChange={(e) => set('nutrition', { ...form.nutrition, basis: e.target.value as 'user-entered' | 'estimated' })}>
                    <option value="user-entered">Entered by me</option>
                    <option value="estimated">An estimate</option>
                  </select>
                </label>
              </div>
              <p className="hint">Shown as unverified reference information only.</p>
            </div>
          )}
        </fieldset>

        <div className="form-footer">
          <Link to={initial ? `/recipes/${initial.id}` : '/recipes'} className="btn btn-ghost">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Save recipe'}
          </button>
        </div>
      </form>
    </div>
  );
}

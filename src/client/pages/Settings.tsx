import { useEffect, useState } from 'react';
import { CONFLICT_STRATEGIES, type ConflictStrategy, type ImportPreview } from '../../shared/backup';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '../../shared/schema';
import { api, ApiError, errorMessage } from '../api';
import { ErrorState, Loading, PageHeader } from '../components/common';
import { IconSpark } from '../components/Icons';
import { useConfirm, useDocumentTitle, useLoader, useRecipes, useToast } from '../state';

const STRATEGY_TEXT: Record<ConflictStrategy, { label: string; help: string }> = {
  skip: { label: 'Keep mine', help: 'Records that already exist here are left untouched (safest).' },
  copy: { label: 'Keep both', help: 'Differing records are imported as new copies alongside yours.' },
  replace: { label: 'Use the backup’s version', help: 'Differing records are overwritten with the backup’s version.' },
};

export function Settings() {
  useDocumentTitle('Settings & Backup');
  return (
    <div className="page settings-page">
      <PageHeader title="Settings & Backup" kicker="Your data, on your computer" />
      <BackupSection />
      <AiSection />
      <section className="card" aria-labelledby="storage-title">
        <h2 id="storage-title" className="section-title small-title">
          Where your data lives
        </h2>
        <p>
          Recipes, pantry, meal plan and shopping list are stored in a SQLite database (<code>data/cookbook.db</code>) inside the app folder, and uploaded
          photos in <code>data/uploads/</code>. The app only runs on this computer (127.0.0.1) and makes no internet requests.
        </p>
      </section>
    </div>
  );
}

function BackupSection() {
  const { reload } = useRecipes();
  const toast = useToast();
  const confirm = useConfirm();
  const [file, setFile] = useState<{ name: string; data: unknown } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<ConflictStrategy>('skip');
  const [busy, setBusy] = useState(false);

  const choose = async (f: File | undefined) => {
    setPreview(null);
    setErrors([]);
    setFile(null);
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return setErrors(['That file is larger than 15 MB — it doesn’t look like a Cookbook backup.']);
    let data: unknown;
    try {
      data = JSON.parse(await f.text());
    } catch {
      return setErrors(['That file isn’t valid JSON.']);
    }
    try {
      setPreview(await api.backup.preview(data));
      setFile({ name: f.name, data });
    } catch (err) {
      setErrors(err instanceof ApiError ? [err.message, ...err.details] : [errorMessage(err)]);
    }
  };

  const conflicts = preview?.sections.reduce((n, s) => n + s.conflicts.length, 0) ?? 0;
  const incoming = preview?.sections.reduce((n, s) => n + s.new, 0) ?? 0;

  const runImport = async () => {
    if (!file || !preview) return;
    const ok = await confirm({
      title: 'Import this backup?',
      message: (
        <p>
          {incoming} new record{incoming === 1 ? '' : 's'} will be added.
          {conflicts > 0 && ` ${conflicts} record${conflicts === 1 ? '' : 's'} that differ from yours: “${STRATEGY_TEXT[strategy].label}”.`}
          {strategy === 'replace' && conflicts > 0 && ' Your current versions of those records will be overwritten — export a backup first if unsure.'}
        </p>
      ),
      confirmLabel: 'Import',
      danger: strategy === 'replace' && conflicts > 0,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.backup.import(file.data, strategy);
      await reload();
      toast(`Import finished: ${r.added} added, ${r.replaced} replaced, ${r.copied} copied, ${r.skipped} unchanged.`, 'success');
      if (r.warnings.length) setErrors(r.warnings);
      setPreview(null);
      setFile(null);
    } catch (err) {
      setErrors(err instanceof ApiError ? [err.message, ...err.details] : [errorMessage(err)]);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    try {
      const { added } = await api.recipes.restoreStarters();
      await reload();
      toast(added ? `Restored ${added} starter recipe${added === 1 ? '' : 's'}.` : 'All starter recipes are already in your cookbook.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <section className="card" aria-labelledby="backup-title">
      <h2 id="backup-title" className="section-title small-title">
        Backup &amp; restore
      </h2>
      <p>Download everything — recipes, pantry, meal plan and shopping list — as a single JSON file. Keep it somewhere safe.</p>
      <div className="button-row">
        <a className="btn btn-primary" href={api.backup.exportUrl} download>
          Export backup
        </a>
      </div>
      <p className="muted small">Uploaded photos aren’t included in the file; copy the <code>data/uploads</code> folder to keep them too.</p>

      <h3 className="subhead">Restore from a backup</h3>
      <p>Choose a backup file to see what it contains. Nothing changes until you confirm the import.</p>
      <label className="btn btn-ghost file-btn">
        Choose backup file…
        <input
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {errors.length > 0 && (
        <div className="form-errors" role="alert">
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {preview && file && (
        <div className="import-preview" aria-live="polite">
          <p>
            <strong>{file.name}</strong> — exported {new Date(preview.exportedAt).toLocaleString()}
          </p>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col">In file</th>
                <th scope="col">New</th>
                <th scope="col">Already identical</th>
                <th scope="col">Differs from yours</th>
              </tr>
            </thead>
            <tbody>
              {preview.sections.map((s) => (
                <tr key={s.key}>
                  <th scope="row">{s.label}</th>
                  <td>{s.total}</td>
                  <td>{s.new}</td>
                  <td>{s.identical}</td>
                  <td>{s.conflicts.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {conflicts > 0 && (
            <>
              <details>
                <summary>Show the {conflicts} differing record{conflicts === 1 ? '' : 's'}</summary>
                <ul>
                  {preview.sections.flatMap((s) =>
                    s.conflicts.map((c) => (
                      <li key={`${s.key}-${c.id}`}>
                        {s.label}: “{c.incoming}” (yours: “{c.existing}”)
                      </li>
                    )),
                  )}
                </ul>
              </details>
              <fieldset className="radio-group">
                <legend>When a record differs from yours</legend>
                {CONFLICT_STRATEGIES.map((s) => (
                  <label key={s} className="radio">
                    <input type="radio" name="strategy" value={s} checked={strategy === s} onChange={() => setStrategy(s)} />
                    <span>
                      <strong>{STRATEGY_TEXT[s].label}</strong> — {STRATEGY_TEXT[s].help}
                    </span>
                  </label>
                ))}
              </fieldset>
            </>
          )}
          <div className="button-row">
            <button type="button" className="btn btn-ghost" onClick={() => (setPreview(null), setFile(null))}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={runImport} disabled={busy}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      )}

      <h3 className="subhead">Starter recipes</h3>
      <p>Bring back any of the starter recipes you deleted. Existing recipes are not changed.</p>
      <button type="button" className="btn btn-ghost" onClick={restore}>
        Restore starter recipes
      </button>
    </section>
  );
}

function AiSection() {
  const settings = useLoader(() => api.ai.settings(), []);
  const toast = useToast();
  const [form, setForm] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  const save = async (next: AiSettings) => {
    try {
      const saved = await api.ai.saveSettings(next);
      setForm(saved);
      settings.setData(() => saved);
      toast(saved.enabled ? 'AI assistance enabled.' : 'AI settings saved.', 'success');
      return true;
    } catch (err) {
      toast(err instanceof ApiError && err.details.length ? err.details.join(' ') : errorMessage(err), 'error');
      return false;
    }
  };

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      if (!(await save(form))) return;
      const s = await api.ai.status();
      setStatus(
        s.modelInstalled
          ? { ok: true, text: `Connected. Model “${form.model}” is installed.` }
          : { ok: false, text: `Connected, but “${form.model}” isn’t installed. Installed: ${s.models.join(', ') || 'none'}.` },
      );
    } catch (err) {
      setStatus({ ok: false, text: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  if (settings.loading && !settings.data) return <Loading />;
  if (settings.error) return <ErrorState message={settings.error} onRetry={settings.reload} />;

  return (
    <section className="card" aria-labelledby="ai-settings-title">
      <h2 id="ai-settings-title" className="section-title small-title">
        <IconSpark size={18} /> Local AI assistant (optional)
      </h2>
      <p>
        If you run Ollama on this computer, the cookbook can ask a small local
        model (such as an 8B Llama) to suggest ingredient substitutions or draft a new recipe. It is off by default, everything else works without it, and
        suggestions are always shown for review — the AI never changes your recipes, pantry or plans on its own.
      </p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(form);
        }}
      >
        <label className="check-inline">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enable AI assistance
        </label>
        <div className="field-row">
          <label className="field field-grow">
            <span className="label">Ollama address</span>
            <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} aria-describedby="ollama-hint" />
            <span id="ollama-hint" className="hint">
              Must be on this computer (127.0.0.1 or localhost). Remote servers are refused.
            </span>
          </label>
          <label className="field">
            <span className="label">Model name</span>
            <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </label>
        </div>
        <div className="button-row">
          <button type="submit" className="btn btn-primary">
            Save AI settings
          </button>
          <button type="button" className="btn btn-ghost" onClick={test} disabled={testing || !form.enabled}>
            {testing ? 'Testing…' : 'Save & test connection'}
          </button>
        </div>
        {status && (
          <p className={status.ok ? 'form-success' : 'form-error'} role="status">
            {status.text}
          </p>
        )}
      </form>
    </section>
  );
}

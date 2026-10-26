# Architecture

The Cookbook is a single-user, local-first web app: a React UI in the browser, plus a small Node server on `127.0.0.1` that owns a SQLite database.

```
Browser (React SPA)  ──HTTP/JSON, same origin──▶  Node server (127.0.0.1)  ──▶  data/cookbook.db (SQLite)
                                                        │                        data/uploads/*.png|jpg|webp
                                                        └──(optional, only if enabled)──▶ Ollama on 127.0.0.1
```

## Layout

| Path            | What                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `src/shared/`   | Code used by both sides: zod schemas/types, scaling, ingredient normalization, pantry matching, search, shopping-merge rules, dates, backup format. Pure functions, unit-tested. |
| `src/server/`   | `db.ts` (open + migrations), `store.ts` (data-access layer), `app.ts` (HTTP routes, static files, security checks), `ai.ts` (Ollama adapter), `images.ts`, `seed.ts`, `main.ts` (entry point). |
| `src/client/`   | React app: `pages/`, `components/`, `api.ts` (typed fetch client), `state.tsx` (recipes cache, toasts, confirm dialog), `styles.css`. |
| `tests/`        | Vitest unit, persistence, HTTP and mocked-AI tests.                   |
| `e2e/`          | Playwright browser smoke tests and the throwaway test server.         |

**Stack:** TypeScript, React 19, React Router 7, Vite 7, zod, Node's built-in `node:sqlite`, and `tsx` to run the TypeScript server. There is no web framework; `app.ts` is a plain `node:http` server with about 34 routes.

## Data

**Storage.** Data is stored in SQLite at `data/cookbook.db` (override with `COOKBOOK_DATA_DIR`), in WAL mode with foreign keys on.

| Table            | Contents                                                                 |
| ---------------- | ------------------------------------------------------------------------ |
| `recipes`        | `id`, `title`, `data` (JSON: structured ingredients, ordered steps, etc.), timestamps |
| `pantry_items`   | `id`, `data` (JSON), timestamps                                           |
| `meals`          | `id`, `date`, `slot`, `recipe_id` → `recipes(id)` ON DELETE CASCADE, `servings`, `note` |
| `shopping_items` | `id`, `data` (JSON, including `sources` back-references to recipes/meals), timestamps |
| `settings`       | key/value (AI settings, "seeded" marker)                                  |

**Validation.** Every write is validated with the shared zod schemas, and every read is validated again, so a damaged row surfaces as an error instead of breaking the UI.

**Migrations.** Migrations are an ordered list in `db.ts`. Each one runs inside a transaction and bumps `PRAGMA user_version`. A database from a newer app version is refused rather than opened.

**Recipe model.** Each recipe has a stable `id` (UUID; starter recipes use `seed-…`) and:

- ingredients as `{quantity: number|null, unit, name, note, optional, staple}`;
- steps as `string[]`;
- prep and cook minutes, servings, difficulty, tags, cuisine and dietary labels;
- favorite, rating (1–5), user notes and source note;
- `imagePath`, which must match `uploads/<32 hex>.(png|jpg|webp)`;
- nutrition, labelled `user-entered` or `estimated`;
- created and updated timestamps.

## Key logic (all deterministic, in `src/shared/`)

- **Scaling** (`quantity.ts`). Amounts are multiplied by target/original servings and rounded to 3 decimals. They display as kitchen fractions (1/8 … 7/8) when within 0.01, otherwise as decimals. Blank quantities are untouched, invalid servings are rejected, and the saved recipe is never mutated.
- **Ingredient names** (`ingredients.ts`). Names are lower-cased and stripped of punctuation and accents, the last word is singularized, and a small explicit alias map is applied. Nothing else is fuzzy.
- **Pantry matching** (`matching.ts`). Each ingredient becomes `have`, `assumed-staple`, `missing` or `optional-missing`. A recipe is "ready" only when no required ingredient is missing. Expired items and smaller same-unit quantities produce warnings, and each result carries a plain-language summary.
- **Shopping merge** (`shopping.ts`). Two items merge only when the normalized name and unit are identical, the existing item isn't checked, and both quantities are numeric or both are blank. Re-adding the same planned meal is skipped, and manual items are never removed by adding meals.

## Server security (local app, but still careful)

- The server binds to `127.0.0.1`, and requests whose `Host` isn't localhost/127.0.0.1/[::1] are rejected, which protects against DNS rebinding.
- JSON endpoints require `Content-Type: application/json`, so other websites can't send cross-site "simple" form posts.
- Destructive endpoints require explicit confirmation: deleting a recipe needs `?confirm=true`, and clearing checked items or importing a backup needs `confirm: true`. The UI always shows a dialog first.
- The built UI is served with a strict Content-Security-Policy (`default-src 'self'`), so the page can't load or send anything off-machine.
- Static-file paths are resolved and checked against the build directory.
- Uploads are checked by magic bytes (PNG, JPEG or WebP only), capped at 5 MB, given random names and stored only in `data/uploads/`.
- There is no telemetry, analytics or authentication service, and no network access except the optional local Ollama.

## Optional AI (`src/server/ai.ts`)

- `OllamaClient` is created per request from the saved settings. If AI isn't enabled, it throws `disabled`.
- The base URL must be a loopback http(s) URL without credentials.
- Calls go to `POST /api/chat` with `stream: false` and `temperature: 0.2`, plus a JSON schema in `format`; the reply is parsed and validated with zod. Errors are typed as `disabled`, `invalid-config`, `unavailable`, `timeout`, `bad-response` or `invalid-output`, and the UI shows them alongside a non-AI fallback.
- `suggestSubstitutions` sends only the recipe title, the other ingredient names and the target ingredient.
- `draftRecipe` sends only the user's short request. It normalizes the result (clamps numbers, strips step numbering, dedupes tags), validates it as a `RecipeInput` and returns it unsaved.
- `askAssistant` answers free-form questions in plain text. `POST /api/ai/ask` takes the question, up to 16 earlier turns and the page path (plus a recipe id and servings on recipe pages). The server looks up the context itself (the recipe, or pantry/shopping/plan names) rather than trusting text from the browser.
- The AI routes have no access to write methods. Tests assert that the database is byte-for-byte unchanged after AI calls.

## Backup format

```jsonc
{
  "format": "the-cookbook-backup",   // required marker
  "version": 1,                       // format version; newer versions are refused
  "exportedAt": "2026-10-18T12:00:00.000Z",
  "data": {
    "recipes":  [ /* Recipe objects, see src/shared/schema.ts */ ],
    "pantry":   [ /* PantryItem */ ],
    "mealPlan": [ /* Meal: id, date, slot, recipeId, servings, note, createdAt */ ],
    "shopping": [ /* ShoppingItem, including sources */ ]
  }
}
```

Import (`Store.importBackup`) runs in one transaction:

- New IDs are inserted as-is, and identical records are skipped.
- Records that differ follow the chosen strategy: `skip` (default), `copy` (new IDs; meal plans are remapped to copied recipes) or `replace`.
- `POST /api/backup/preview` computes the same classification without writing anything.

## Testing

| Layer      | Location                                    | Notes                                                              |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------ |
| Unit       | `tests/quantity`, `matching`, `search`, `shopping-and-dates` | Pure functions.                                     |
| Persistence | `tests/store.test.ts`                      | Temp SQLite files in `.test-tmp/`, including close-and-reopen persistence and migrations. |
| HTTP       | `tests/api.test.ts`                         | Real server on an ephemeral 127.0.0.1 port.                         |
| AI         | `tests/ai.test.ts`                          | Against `tests/mock-ollama.ts`; never a real model.                 |
| Browser    | `e2e/smoke.spec.ts`                         | Two production servers with throwaway databases; all non-loopback requests blocked. |

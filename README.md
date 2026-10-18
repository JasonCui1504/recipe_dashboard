# The Cookbook

A dark-green, offline, local-first personal cookbook and kitchen companion. Keep your recipes, scale them, cook step by step, track your pantry, see what you can make, plan the week and build a shopping list. Everything runs on your own computer, and nothing is sent anywhere.

- **This week's / next week's menu** on the home page: a 7-day lunch & dinner calendar where you pick from your recipes. From Friday it shows next week by default.
- **Grocery plan** (`Shopping List → Plan groceries for a week`): see everything a week's menu needs, scaled and combined, with what's already in your pantry flagged. Untick what you don't need, add the rest to your shopping list, or print it.
- **Discover**: search, quick filters (Quick Meals, Vegetarian, High Protein, Favorites, Use My Pantry), categories, favorites, quick picks and recently added recipes.
- **My Recipes**: your full library, with filtering, sorting, create, edit, duplicate, favorite and delete (deletes ask for confirmation).
- **Recipe page**: an ingredient checklist, serving-size scaling with fractions, an As written / Metric / US unit switch, numbered steps, notes, rating and optional nutrition (always labelled unverified).
- **Cooking mode**: a full-screen view with one large step at a time, previous/next buttons (or ← →), progress, and an ingredient checklist that doesn't lose your place.
- **Pantry**: a simple list of what you have. Add several items at once ("eggs, spinach, rice"); amounts and expiry dates are optional. Tap an item to strike it off when it's finished; it moves to a Finished list with Undo and one-tap Restock. The **What can I cook?** tab explains every match.
- **Meal Planner**: a week view with breakfast, lunch, dinner and custom meals, per-meal servings, and protection against duplicates and repeats.
- **Shopping List**: add items yourself, from a recipe, or from the week's meals. Items are grouped by aisle and combined only when that's safe, and checked-off items stay until you clear them (with confirmation).
- **Backup & restore**: export to a versioned JSON file, then import with a preview and an explicit conflict choice.
- **Optional local AI**: if you run Ollama, a local model (e.g. Llama 3.1 8B) can suggest substitutions or draft a recipe. It's off by default and never saves anything by itself.

## Look and feel

The theme matches [jascui.com](https://jascui.com): a near-black green canvas (`#0d1110`), dark green surfaces, a `#4a7c59` accent and soft green-white text, set in Geist and Geist Mono. The fonts are bundled from npm (`@fontsource-variable/geist*`), so nothing loads from the internet. All the colors are CSS variables at the top of `src/client/styles.css`.

## Requirements

- **Node.js 22.13 or newer.** The app uses Node's built-in SQLite (`node:sqlite`), so there are no native modules to compile.
- npm (comes with Node).
- A modern browser.

## Install

```bash
npm install
```

This is the only step that needs the internet. After it, the app works fully offline: there are no CDNs, remote fonts, remote images, analytics or online APIs.

## Run it like an app (recommended, macOS)

Same setup as the finance dashboard: a background service that starts at login.

```bash
scripts/local/install.sh
```

This builds the app and installs two launchd agents:

- `com.cookbook.server`: the cookbook at **http://127.0.0.1:4173**, started at login and restarted if it stops. Log: `~/Library/Logs/cookbook-server.log`.
- `com.cookbook.backup`: a daily 21:00 copy of the database to `~/cookbook-backups/cookbook-YYYY-MM-DD.db` (newest 30 kept), plus a mirror of your photos in `~/cookbook-backups/uploads/`. Run `scripts/local/backup.sh` for a backup any time.

Then open http://127.0.0.1:4173 in Safari and choose **File → Add to Dock** for a standalone window with the cookbook icon. If you added it to the Dock before the icon existed, remove it from the Dock and add it again to pick up the icon.

After pulling new code, run `scripts/local/install.sh` again to rebuild and restart. `scripts/local/uninstall.sh` stops the cookbook and removes the agents; your data and backups stay.

While the agents are installed, don't also run `npm start` (same port). Use `npm run dev` for development; it runs on 5173/5174.

To restore a backup:

```bash
scripts/local/uninstall.sh
cp ~/cookbook-backups/cookbook-2026-10-18.db data/cookbook.db
rm -f data/cookbook.db-wal data/cookbook.db-shm
scripts/local/install.sh
```

## Run by hand

**Everyday use** (production build, one server):

```bash
npm run build      # once, and again after updating the code
npm start          # → http://127.0.0.1:4173
```

**Development** (hot reload):

```bash
npm run dev        # UI → http://127.0.0.1:5173 (API on 127.0.0.1:5174)
```

Stop either one with `Ctrl+C`.

Both servers bind to `127.0.0.1` only, so the cookbook can't be reached from other devices on your network. The server also refuses requests addressed to any hostname other than localhost.

Environment options:

| Variable            | Default                          | Meaning                                         |
| ------------------- | -------------------------------- | ----------------------------------------------- |
| `PORT`              | `4173` (start) / `5174` (dev API) | Port to listen on (always on 127.0.0.1)         |
| `COOKBOOK_DATA_DIR` | `data`                           | Folder for the database and photos (relative to the project) |

## Where your data lives

| What                                        | Where                       |
| ------------------------------------------- | --------------------------- |
| Recipes, pantry, meal plan, shopping list, settings | `data/cookbook.db` (SQLite) |
| Uploaded recipe photos                      | `data/uploads/`             |

`data/` is git-ignored. The local server must be running for the app to work, because the browser talks to the database through it; a static HTML page can't open SQLite files.

Ten original starter recipes are added the first time a database is created. After that they're ordinary recipes you can edit or delete. **Settings → Restore starter recipes** brings back any you deleted.

## Backup and restore

**Back up:** open **Settings** (gear icon) and choose **Export backup**. This downloads `cookbook-backup-YYYY-MM-DD.json` with all recipes, pantry items, planned meals and shopping-list items. Photos aren't embedded, so copy `data/uploads/` as well if you want to keep them.

Alternatively, stop the app and copy the whole `data/` folder.

**Restore:** open **Settings → Choose backup file…**. The app validates the file and shows a preview: how many records are new, already identical, or different from yours. Nothing changes until you confirm.

When a record in the backup has the same ID as one of yours but different content, you choose what happens:

- **Keep mine** (default): your version stays untouched.
- **Keep both**: the backup's version is imported as a new copy (recipe titles get "(imported)").
- **Use the backup's version**: yours is overwritten. You're asked to confirm first.

Identical records are always skipped, so importing the same file twice does nothing. Meal-plan entries whose recipe is missing are skipped with a warning. Files from a newer app version are refused with a clear message. The file format is documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#backup-format).

## Optional: local AI with Ollama

AI is **off by default**. Every feature works without it.

1. You need a local Ollama with a model. If the finance dashboard's model server is installed (`~/.finance-ollama`, which already has `llama3.1:8b`), `scripts/local/install.sh` points the cookbook at it (`http://127.0.0.1:11435`), so nothing extra to download. Otherwise, run Ollama yourself and pull a model, e.g. `ollama pull llama3.1:8b` (default address `http://127.0.0.1:11434`).
2. In the cookbook, open **Settings → Local AI assistant**, tick **Enable AI assistance**, check the address and model name, then **Save & test connection**.

What it does:

- **Substitute?** buttons on recipe ingredients show up to 3 suggestions, clearly labelled as unverified AI output. Your recipe isn't changed.
- **Draft with AI** on a new recipe fills the form with a draft for you to review. Nothing is saved until you press **Save**, and leaving the page asks before discarding it.

Safeguards:

- Only loopback addresses (`127.0.0.1`, `localhost`, `::1`) are accepted, and there is never a cloud fallback.
- Prompts are short and include only the recipe in question.
- The model is asked for JSON, and its answer is validated against a schema; malformed answers are discarded with a clear message.
- Output is rendered as plain text, never as HTML or code.
- The AI endpoints can't write to the database.

To turn AI off, untick **Enable AI assistance** and save.

## Tests and checks

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript (app, server and tests)
npm test            # Vitest: unit + persistence + HTTP API + mocked-Ollama tests
npm run test:e2e    # Builds, then runs Playwright browser smoke tests
npm run check       # lint + typecheck + unit tests
```

Tests never touch `data/`. Temporary databases are created in `.test-tmp/` (git-ignored) and deleted afterwards. Ollama is always mocked: a fake server on a random 127.0.0.1 port. The browser tests block every request that isn't to 127.0.0.1 and fail on console errors.

To run the browser tests you need a Playwright Chromium. Either run `npx playwright install chromium` once, or point at an existing Chromium with `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

## Known limitations

- **Ingredient matching is deliberately strict.** It ignores case, plurals and a small synonym list (e.g. scallion → green onion), but "oil" won't match "olive oil". Quantities are compared only when units are identical.
- **Unit conversion stays within a kind of measure.** Weights (g, kg, oz, lb) and volumes (tsp, tbsp, cup, ml, l, fl oz…) convert and combine; "1 cup rice" and "200 g rice" stay separate, because converting volume to weight depends on the ingredient. Cups and spoons are US measures.
- **Scaling only changes ingredient amounts.** Cooking times, pan sizes and seasoning may need adjusting, and the recipe page says so.
- **Cooking mode doesn't keep the screen awake.** Use your device's display settings if needed.
- **Backups don't embed photos.** Copy `data/uploads/`. Photos removed from a recipe (or uploaded but never saved) stay in `data/uploads/` until you delete them.
- **Pantry quantities are never deducted automatically.** Use "Mark used" when you finish something.
- **Single-user.** There is no login and no sync between devices; the app is meant for one person on one computer.
- **Node's built-in SQLite is marked "experimental"** in Node 22. The start scripts hide that warning, and the app has its own schema migrations.
- **AI quality depends on your local model.** An 8B model can be wrong, so treat suggestions as ideas, not facts, especially for allergens, nutrition and food safety.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it's built.

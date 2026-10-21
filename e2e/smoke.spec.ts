import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { startMockOllama } from '../tests/mock-ollama';

/**
 * Main user flows, run with AI disabled and every non-loopback request
 * blocked. Any console error or outside request fails the test.
 */

const external: string[] = [];
const consoleErrors: string[] = [];

test.beforeEach(async ({ page, context }) => {
  external.length = 0;
  consoleErrors.length = 0;
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    external.push(url.href);
    return route.abort();
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
});

test.afterEach(() => {
  expect(external, 'no requests may leave this computer').toEqual([]);
  // Deliberate error responses (409 duplicate meal, 502 malformed AI output) are logged by
  // the browser as failed resources; ignore exactly those.
  expect(consoleErrors.filter((e) => !/Failed to load resource: .*status of (409|502)/.test(e))).toEqual([]);
});

async function openRecipe(page: Page, query: string, title: string) {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search recipes' }).fill(query);
  await page.getByRole('link', { name: new RegExp(title) }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

test('discover, search, detail, scaling and cooking mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What sounds good?' })).toBeVisible();
  await expect(page.locator('.recipe-card').first()).toBeVisible();

  // Search + quick filter
  await page.getByRole('searchbox', { name: 'Search recipes' }).fill('lentil');
  await expect(page.locator('.recipe-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Quick Meals' }).click();
  await expect(page.getByText('No recipes found')).toBeVisible();
  await page.getByRole('button', { name: 'Quick Meals' }).click();

  await page.getByRole('link', { name: /Simple Lentil Soup/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Simple Lentil Soup' })).toBeVisible();
  const lentils = page.locator('.checklist li', { hasText: 'red lentils' });
  await expect(lentils).toContainText('1 cup red lentils');

  // Scale 4 → 8 servings, then 4 → 2 (fractions)
  const servings = page.getByRole('spinbutton', { name: 'Servings' });
  await servings.fill('8');
  await expect(lentils).toContainText('2 cup red lentils');
  await expect(page.getByRole('note')).toContainText('may not scale in a straight line');
  await servings.fill('2');
  await expect(lentils).toContainText('1/2 cup red lentils');
  await expect(page.locator('.checklist li', { hasText: 'salt' })).toContainText('salt, to taste');

  // Unit display: metric converts cups; "as written" restores them
  await page.getByRole('group', { name: 'Units' }).getByRole('button', { name: 'Metric' }).click();
  await expect(lentils).toContainText('≈ 120 ml red lentils');
  await page.getByRole('group', { name: 'Units' }).getByRole('button', { name: 'As written' }).click();
  await expect(lentils).toContainText('1/2 cup red lentils');

  // Ingredient checklist is temporary UI state
  await lentils.getByRole('checkbox').check();
  await expect(lentils).toHaveClass(/is-checked/);

  // Cooking mode
  await page.getByRole('link', { name: 'Start Cooking' }).click();
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  await page.getByRole('button', { name: /Next/ }).click();
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await expect(page).toHaveURL(/step=2/);
  await page.reload();
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('Step 3 of 5')).toBeVisible();
  await page.getByRole('button', { name: /Previous/ }).click();
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await page.getByRole('button', { name: /Ingredients \(/ }).click();
  await expect(page.getByRole('complementary', { name: 'Ingredients' })).toContainText('1/2 cup red lentils');
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await page.getByRole('link', { name: 'Exit cooking mode' }).click();
  await expect(page).toHaveURL(/\/recipes\/seed-simple-lentil-soup\?servings=2$/);
});

test('favorite persists, meal plan, shopping list check-off', async ({ page }) => {
  await openRecipe(page, 'salmon', 'Salmon Rice Bowl');

  const fav = page.locator('.action-bar').getByRole('button', { name: /favorites/ });
  await expect(fav).toHaveAttribute('aria-pressed', 'false');
  await fav.click();
  await expect(fav).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('.action-bar').getByRole('button', { name: /favorites/ })).toHaveAttribute('aria-pressed', 'true');

  // Add to meal plan (today, dinner)
  await page.getByRole('button', { name: 'Add to Meal Plan' }).click();
  const dialog = page.getByRole('dialog', { name: /Plan/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Add to plan' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Planned Salmon Rice Bowl' })).toBeVisible();

  // Adding the exact same meal again is refused
  await page.getByRole('button', { name: 'Add to Meal Plan' }).click();
  await dialog.getByRole('button', { name: 'Add to plan' }).click();
  await expect(dialog.getByRole('alert')).toContainText('already planned');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('link', { name: 'Meal Planner' }).click();
  await expect(page.locator('.day.is-today .meal')).toContainText('Salmon Rice Bowl');
  await expect(page.getByText('1 meal planned this week')).toBeVisible();

  // Review the week's groceries, then add them
  await page.getByRole('link', { name: 'Review groceries for this week' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Grocery plan' })).toBeVisible();
  await page.getByRole('button', { name: /Add \d+ items? to shopping list/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Shopping list updated' })).toBeVisible();
  await expect(page).toHaveURL(/\/shopping$/);
  const salmon = page.locator('.shopping-row', { hasText: 'salmon fillets' });
  await expect(salmon).toBeVisible();
  await expect(salmon).toContainText('Salmon Rice Bowl');

  // Manual item, then check one off and verify it persists
  await page.getByLabel('Item *').fill('Lemons');
  await page.getByLabel('Quantity', { exact: true }).first().fill('3');
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(page.locator('.shopping-row', { hasText: 'Lemons' })).toBeVisible();

  await salmon.getByRole('checkbox').check();
  await expect(page.getByRole('heading', { name: /In the basket \(1\)/ })).toBeVisible();
  await page.reload();
  await expect(page.locator('.shopping-row', { hasText: 'salmon fillets' }).getByRole('checkbox')).toBeChecked();

  // Checking an item off puts it in the pantry; unchecking it takes it back out.
  const pantryNames = async () => ((await (await page.request.get('/api/pantry')).json()) as Array<{ name: string; usedUp: boolean }>).filter((p) => !p.usedUp).map((p) => p.name);
  expect(await pantryNames()).toContain('salmon fillets');
  const lemons = page.locator('.shopping-row', { hasText: 'Lemons' });
  await lemons.getByRole('checkbox').check();
  await expect(page.getByRole('status').filter({ hasText: 'Added Lemons to your pantry' })).toBeVisible();
  expect(await pantryNames()).toContain('Lemons');
  await lemons.getByRole('checkbox').uncheck();
  await expect(page.getByRole('status').filter({ hasText: 'Took Lemons back out of your pantry' })).toBeVisible();
  expect(await pantryNames()).not.toContain('Lemons');

  // Clearing completed items asks first
  await page.getByRole('button', { name: 'Clear completed' }).click();
  const confirm = page.getByRole('dialog', { name: 'Clear completed items?' });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.shopping-row', { hasText: 'salmon fillets' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear completed' }).click();
  await confirm.getByRole('button', { name: 'Clear completed' }).click();
  await expect(page.locator('.shopping-row', { hasText: 'salmon fillets' })).toHaveCount(0);
  await expect(page.locator('.shopping-row', { hasText: 'Lemons' })).toBeVisible();
});

test('home menu calendar: pick breakfast, lunch & dinner, then plan next week’s groceries', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('group', { name: 'Which week' }).getByRole('button', { name: 'Next week' }).click();
  await expect(page.getByRole('heading', { name: 'Next week’s menu' })).toBeVisible();

  await expect(page.getByRole('combobox', { name: /^Choose breakfast for Monday/ })).toBeVisible();
  // Search instead of a dropdown: type part of a name, ingredient or tag, then pick.
  const lunch = page.getByRole('combobox', { name: /^Choose lunch for Monday/ });
  await lunch.fill('spinach pas');
  await page.getByRole('option', { name: /Tomato and Spinach Pasta/ }).click();
  await expect(page.locator('.menu-day').first().locator('.menu-meal')).toContainText('Tomato and Spinach Pasta');
  // Keyboard: the first match is highlighted, Enter picks it.
  const tueDinner = page.getByRole('combobox', { name: /^Choose dinner for Tuesday/ });
  await tueDinner.fill('chickpea');
  await expect(page.getByRole('option', { name: /Chickpea and Spinach Curry/ })).toHaveAttribute('aria-selected', 'true');
  await tueDinner.press('Enter');
  await expect(page.locator('.menu-day').nth(1)).toContainText('Chickpea and Spinach Curry');

  // Repeating a recipe in the same week asks first
  await page.getByRole('combobox', { name: /^Choose dinner for Wednesday/ }).fill('curry');
  await page.getByRole('option', { name: /Chickpea and Spinach Curry/ }).click();
  await page.getByRole('dialog', { name: 'Repeat this meal?' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.menu-day').nth(2).locator('.menu-meal')).toHaveCount(0);

  // The menu survives a reload
  await page.reload();
  await page.getByRole('group', { name: 'Which week' }).getByRole('button', { name: 'Next week' }).click();
  await expect(page.locator('.menu-day').first()).toContainText('Tomato and Spinach Pasta');

  // The planner's "Add" dialog uses the same search
  await page.goto('/planner');
  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('button', { name: /Add a recipe to breakfast on Thursday/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a meal' });
  await dialog.getByRole('combobox', { name: 'Search for a recipe' }).fill('oats');
  await expect(dialog.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await dialog.getByRole('option', { name: /Overnight Oats/ }).click();
  await expect(dialog.locator('.picked-recipe')).toContainText('Overnight Oats');
  await dialog.getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.locator('.day', { hasText: 'Thursday' }).locator('.meal')).toContainText('Overnight Oats');

  // Add spinach to the pantry so the review shows it as already there
  await page.goto('/pantry');
  await page.getByLabel('Add to pantry').fill('baby spinach');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.pantry-item', { hasText: 'baby spinach' })).toBeVisible();

  await page.goto('/');
  await page.getByRole('group', { name: 'Which week' }).getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('link', { name: 'Groceries for this menu' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Grocery plan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next week', pressed: true })).toBeVisible();

  // Spinach appears in both recipes → one combined line (2 + 3 cups), unticked because it's in the pantry
  const spinach = page.locator('.grocery-row', { hasText: 'baby spinach' });
  await expect(spinach).toHaveCount(1);
  await expect(spinach).toContainText('5 cups');
  await expect(spinach).toContainText('In pantry');
  await expect(spinach.getByRole('checkbox')).not.toBeChecked();
  const tomatoes = page.locator('.grocery-row', { hasText: 'crushed tomatoes' });
  await expect(tomatoes).toContainText('2 can');
  await expect(tomatoes.getByRole('checkbox')).toBeChecked();
  await expect(page.locator('.grocery-row', { hasText: /^salt/ }).first().getByRole('checkbox')).not.toBeChecked();

  // Untick chickpeas too, then add the rest
  await page.locator('.grocery-row', { hasText: 'chickpeas' }).getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: /Add \d+ items to shopping list/ }).click();
  await expect(page).toHaveURL(/\/shopping$/);
  await expect(page.locator('.shopping-row', { hasText: 'crushed tomatoes' })).toBeVisible();
  await expect(page.locator('.shopping-row', { hasText: 'chickpeas' })).toHaveCount(0);
  await expect(page.locator('.shopping-row', { hasText: 'baby spinach' })).toHaveCount(0);

  // Coming back marks what's already on the list
  await page.goto('/');
  await page.getByRole('group', { name: 'Which week' }).getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('link', { name: 'Groceries for this menu' }).click();
  await expect(page.locator('.grocery-row', { hasText: 'crushed tomatoes' })).toContainText('Already on your list');
});

test('shopping lists per store', async ({ page }) => {
  await page.goto('/shopping');
  await page.getByRole('button', { name: /Add your stores|Manage stores/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Your stores' });
  for (const name of ['Corner Market', 'Bulk Barn']) {
    await dialog.getByLabel('New store name').fill(name);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: `Name of ${name}` })).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Done' }).click();

  // A store's own list: items added there belong to it.
  const tabs = page.getByRole('group', { name: 'Lists by store' });
  await tabs.getByRole('button', { name: /Corner Market/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Corner Market' })).toBeVisible();
  await page.getByLabel('Item *').fill('Basil');
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(page.locator('.shopping-row', { hasText: 'Basil' })).toBeVisible();

  // Move an item from "All" to another store with its store menu.
  await tabs.getByRole('button', { name: /^All/ }).click();
  await page.getByLabel('Item *').fill('Oat milk');
  await page.getByRole('button', { name: 'Add to list' }).click();
  await page.getByLabel('Store for Oat milk').selectOption({ label: 'Bulk Barn' });
  await tabs.getByRole('button', { name: /Bulk Barn/ }).click();
  await expect(page.locator('.shopping-row', { hasText: 'Oat milk' })).toBeVisible();
  await expect(page.locator('.shopping-row', { hasText: 'Basil' })).toHaveCount(0);

  // It's remembered: adding oat milk again with "Where I usually buy it" goes to Bulk Barn.
  await tabs.getByRole('button', { name: /^All/ }).click();
  await page.getByLabel('Store for Oat milk').waitFor();
  await page.locator('.shopping-row', { hasText: 'Oat milk' }).getByRole('checkbox').check();
  await page.getByLabel('Item *').fill('oat milk');
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(page.getByLabel('Store for oat milk')).toHaveValue(/.+/);

  // Removing a store moves its items to "Any store".
  await page.getByRole('button', { name: 'Manage stores' }).click();
  await dialog.getByRole('button', { name: 'Remove Corner Market' }).click();
  await page.getByRole('dialog', { name: 'Remove Corner Market?' }).getByRole('button', { name: 'Remove store' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(tabs.getByRole('button', { name: /Corner Market/ })).toHaveCount(0);
  await tabs.getByRole('button', { name: /Any store/ }).click();
  await expect(page.locator('.shopping-row', { hasText: 'Basil' })).toBeVisible();
});

test('insights page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Insights' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
  // Earlier tests planned today's dinner, which counts as cooked.
  await expect(page.locator('.stat', { hasText: 'Meals planned' }).locator('.stat-value')).not.toHaveText('0');
  await expect(page.getByRole('region', { name: 'Most cooked recipes' })).toContainText('Salmon Rice Bowl');
  await expect(page.getByRole('region', { name: 'Most veggie-packed recipes' }).locator('.bar-row').first()).toBeVisible();
  await page.getByRole('group', { name: 'Time period' }).getByRole('button', { name: 'All time' }).click();
  await expect(page.getByRole('group', { name: 'Time period' }).getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Pantry & food waste' })).toBeVisible();
});

test('create, edit with unsaved-change guard, and delete a recipe', async ({ page }) => {
  await page.goto('/recipes/new');
  await page.getByLabel('Title *').fill('E2E Garlic Toast');
  await page.getByRole('button', { name: 'Save recipe' }).click();
  await expect(page.getByRole('alert')).toContainText('Add at least one ingredient');

  await page.getByRole('button', { name: 'Paste a list' }).click();
  await page.getByLabel('One ingredient per line').fill('2 slices bread\n1 1/2 tbsp butter, softened\n1 clove garlic');
  await page.getByRole('button', { name: 'Add these ingredients' }).click();
  await page.getByRole('textbox', { name: 'Step 1', exact: true }).fill('Toast the bread and spread with garlic butter.');

  // Navigating away with unsaved changes asks first
  await page.getByRole('link', { name: 'Pantry' }).click();
  const guard = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Title *')).toHaveValue('E2E Garlic Toast');

  await page.getByRole('button', { name: 'Save recipe' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Garlic Toast' })).toBeVisible();
  await expect(page.locator('.checklist')).toContainText('1 1/2 tbsp butter, softened');

  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Title *').fill('E2E Garlic Toast Deluxe');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Garlic Toast Deluxe' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this recipe?' });
  await confirm.getByRole('button', { name: 'Delete recipe' }).click();
  await expect(page).toHaveURL(/\/recipes$/);
  await expect(page.locator('.recipe-card', { hasText: 'E2E Garlic Toast Deluxe' })).toHaveCount(0);
});

test('pantry and what-can-I-cook', async ({ page }) => {
  await page.goto('/pantry');
  // Several items at once, comma-separated — no amounts needed.
  await page.getByLabel('Add to pantry').fill('eggs, avocado, sourdough bread, Lemon juice');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  for (const name of ['eggs', 'avocado', 'sourdough bread', 'Lemon juice']) {
    await expect(page.locator('.pantry-item', { hasText: name })).toBeVisible();
  }
  // Optional details for a single item
  await page.getByLabel('Add to pantry').fill('milk');
  await page.getByRole('button', { name: /Add details/ }).click();
  await page.getByLabel('Expires').fill('2099-01-31');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const milk = page.locator('.pantry-item').filter({ has: page.locator('.pantry-name', { hasText: /^milk$/i }) });
  await expect(milk).toContainText('Use by');
  await page.getByRole('tab', { name: 'What can I cook?' }).click();
  const toast = page.locator('.match-card', { hasText: 'Avocado and Egg Toast' });
  await expect(toast).toContainText('Ready to cook');
  await toast.getByText('Show how this was matched').click();
  await expect(toast).toContainText('assumed staple');

  await page.getByLabel('Assume I have pantry staples (salt, oil…)').uncheck();
  await expect(toast).toContainText('Missing');

  // Strike an item off: it moves to "Finished", can be undone, and restocked.
  await page.getByRole('tab', { name: 'Inventory' }).click();
  await page.getByRole('button', { name: 'Finished avocado' }).click();
  await expect(page.locator('.finished-item', { hasText: 'avocado' })).toBeVisible();
  await expect(page.locator('.pantry-item', { hasText: 'avocado' })).toHaveCount(0);
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.pantry-item', { hasText: 'avocado' })).toBeVisible();

  await page.getByRole('button', { name: 'Finished eggs' }).click();
  await expect(page.locator('.finished-item', { hasText: 'eggs' })).toBeVisible();
  await page.getByRole('tab', { name: 'What can I cook?' }).click();
  await expect(page.locator('.match-card', { hasText: 'Avocado and Egg Toast' })).toContainText('eggs');
  await page.getByRole('tab', { name: 'Inventory' }).click();
  await page.getByRole('button', { name: 'Restock eggs' }).click();
  await expect(page.locator('.pantry-item', { hasText: 'eggs' })).toBeVisible();

  // Typing a finished item again brings it back rather than duplicating it.
  await page.getByRole('button', { name: 'Finished milk' }).click();
  await expect(page.locator('.finished-item', { hasText: 'milk' })).toBeVisible();
  await page.getByLabel('Add to pantry').fill('Milk');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(milk).toHaveCount(1);
  await expect(page.locator('.finished-item')).toHaveCount(0);

  // Everything "What can I cook?" says is missing, in one list.
  await page.getByRole('tab', { name: 'Missing ingredients' }).click();
  const first = page.locator('.missing-item').first();
  await expect(first).toBeVisible();
  await expect(first).toContainText('For');
  await first.getByRole('button', { name: 'Add to shopping list' }).click();
  await expect(first.getByRole('button', { name: 'On the list' })).toBeDisabled();
});

test('export a backup and restore it into a clean database', async ({ page, browser }, testInfo) => {
  await page.goto('/settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export backup' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^cookbook-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const file = testInfo.outputPath('backup.json');
  await download.saveAs(file);
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  expect(backup.format).toBe('the-cookbook-backup');
  const favoriteIds = backup.data.recipes.filter((r: { favorite: boolean }) => r.favorite).map((r: { id: string }) => r.id);
  expect(favoriteIds).toContain('seed-salmon-rice-bowl');

  // Second, clean server (its own temp database).
  const clean = await browser.newPage({ baseURL: 'http://127.0.0.1:4311' });
  await clean.goto('/settings');
  await clean.getByLabel('Choose backup file…').setInputFiles(file);
  await expect(clean.getByRole('table')).toBeVisible();
  // The clean DB already has the identical starter recipes; the favorite one differs.
  await expect(clean.getByText(/Show the \d+ differing record/)).toBeVisible();
  await clean.getByLabel(/Use the backup’s version/).check();
  await clean.getByRole('button', { name: 'Import' }).click();
  await clean.getByRole('dialog', { name: 'Import this backup?' }).getByRole('button', { name: 'Import' }).click();
  await expect(clean.getByRole('status').filter({ hasText: 'Import finished' })).toBeVisible();

  await clean.goto('/recipes?f=favorites');
  await expect(clean.getByRole('link', { name: /Salmon Rice Bowl/ })).toBeVisible();
  await clean.goto('/shopping');
  await expect(clean.locator('.shopping-row', { hasText: 'Lemons' })).toBeVisible();

  // Invalid files get a clear message and change nothing
  const bad = testInfo.outputPath('bad.json');
  writeFileSync(bad, JSON.stringify({ hello: 'world' }));
  await clean.goto('/settings');
  await clean.getByLabel('Choose backup file…').setInputFiles(bad);
  await expect(clean.getByRole('alert')).toContainText('not a Cookbook backup');
  await clean.close();
});

test('AI is off by default and the app works without it', async ({ page }) => {
  await openRecipe(page, 'omelet', 'Vegetable Omelet');
  await expect(page.getByRole('button', { name: /Suggest substitutes/ })).toHaveCount(0);
  await page.goto('/recipes/new?ai=1');
  await expect(page.getByText('AI drafting is turned off')).toBeVisible();
  await page.goto('/');
  const buddy = page.getByRole('complementary', { name: 'Sprout’s message for today' });
  await expect(buddy).toContainText('Tip of the day', { ignoreCase: true });
  await buddy.getByRole('button', { name: 'Say hi to Sprout' }).click();
  await expect(page.getByRole('button', { name: 'Ask Llama' })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search recipes' }).fill('something light for lunch');
  await expect(page.getByText('Turn on AI in')).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByLabel('Enable AI assistance')).not.toBeChecked();
  await expect(page.getByLabel('Ollama address')).toHaveValue('http://127.0.0.1:11434');
  // The assistant button is on every page and explains how to turn AI on.
  await page.getByRole('button', { name: 'Ask the kitchen assistant' }).click();
  await expect(page.getByRole('dialog', { name: 'Kitchen assistant' })).toContainText('turned off');
  await page.getByRole('button', { name: 'Close the assistant' }).click();
});

test('optional AI with a mock local model: suggestions are previews, nothing saves without the user', async ({ page, request }) => {
  const mock = await startMockOllama(); // fake Ollama on 127.0.0.1 — never a real model
  try {
    await page.goto('/settings');
    await page.getByLabel('Enable AI assistance').check();
    await page.getByLabel('Ollama address').fill(mock.url);
    await page.getByRole('button', { name: 'Save & test connection' }).click();
    await expect(page.getByText('Connected. Model “llama3.1:8b” is installed.')).toBeVisible();

    // Sprout's daily note comes from the model (once a day, then saved)
    mock.reply({ message: 'Rainy Monday? Perfect excuse for curry.' });
    await page.goto('/');
    await expect(page.getByRole('complementary', { name: 'Sprout’s message for today' })).toContainText('Rainy Monday? Perfect excuse for curry.');
    await expect(page.getByRole('complementary', { name: 'Sprout’s message for today' })).toContainText('from your Llama', { ignoreCase: true });

    const before = await (await request.get('/api/backup/export')).json();

    mock.reply({ substitutions: [{ substitute: 'Shallot', amount: '1 small', note: 'Milder.' }] });
    await openRecipe(page, 'curry', 'Chickpea and Spinach Curry');
    await page.getByRole('button', { name: 'Suggest substitutes for onion' }).click();
    const dialog = page.getByRole('dialog', { name: /Substitutes for onion/ });
    await expect(dialog).toContainText('Shallot');
    await expect(dialog).toContainText('unverified');
    await expect(dialog).toContainText('has not been changed');
    await dialog.getByRole('button', { name: 'Close' }).click();

    mock.reply('garbage {');
    await page.getByRole('button', { name: 'Suggest substitutes for garlic' }).click();
    await expect(page.getByRole('dialog')).toContainText('did not return valid JSON');
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

    // Ask Llama from the home-page search
    mock.reply({ picks: [{ id: 'R1', reason: 'Quick and uses what you have.' }], note: '' });
    await page.goto('/');
    await page.getByRole('searchbox', { name: 'Search recipes' }).fill('something cozy for a cold night');
    await page.getByRole('button', { name: 'Ask Llama' }).click();
    const picks = page.locator('.llama-results');
    await expect(picks).toContainText('Llama’s picks for “something cozy for a cold night”');
    await expect(picks.locator('.recipe-card')).toHaveCount(1);
    await expect(picks).toContainText('Quick and uses what you have.');
    mock.reply('not json');
    await page.getByRole('searchbox', { name: 'Search recipes' }).press('Enter');
    await expect(picks.getByRole('alert')).toContainText('did not return valid JSON');

    mock.reply({
      title: 'Mock Lemon Rice',
      description: 'A draft.',
      servings: 2,
      prepMinutes: 5,
      cookMinutes: 15,
      difficulty: 'easy',
      ingredients: [{ quantity: 1, unit: 'cup', name: 'rice', note: '' }],
      steps: ['Cook the rice.'],
      tags: ['side'],
    });
    await page.goto('/recipes/new?ai=1');
    await page.getByLabel('Describe the dish').fill('lemon rice');
    await page.getByRole('button', { name: 'Generate draft' }).click();
    await expect(page.getByLabel('Title *')).toHaveValue('Mock Lemon Rice');
    await expect(page.getByText('It is not saved')).toBeVisible();

    const during = await (await request.get('/api/backup/export')).json();
    expect(during.data).toEqual(before.data);

    // Leaving discards the draft only after confirmation; nothing was written.
    await page.getByRole('link', { name: 'Discover' }).click();
    await page.getByRole('dialog', { name: 'Discard unsaved changes?' }).getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('heading', { name: 'What sounds good?' })).toBeVisible();
    const after = await (await request.get('/api/backup/export')).json();
    expect(after.data).toEqual(before.data);

    // The kitchen assistant answers about the recipe you're on; saving to notes is your call.
    await openRecipe(page, 'curry', 'Chickpea and Spinach Curry');
    await page.getByRole('button', { name: 'Ask the kitchen assistant' }).click();
    const assistant = page.getByRole('dialog', { name: 'Kitchen assistant' });
    await expect(assistant).toContainText('About: Chickpea and Spinach Curry');
    mock.reply({ answer: 'Add 1 cup of diced sweet potato at step 2 and simmer 10 minutes longer.' });
    await assistant.getByLabel('Your question').fill('I want to add sweet potato. How?');
    await assistant.getByLabel('Your question').press('Enter');
    await expect(assistant.locator('.from-ai')).toContainText('diced sweet potato');
    const asked = (mock.requests.at(-1)!.body as { messages: Array<{ content: string }> }).messages.at(-1)!.content;
    expect(asked).toContain('Recipe: Chickpea and Spinach Curry');
    expect((await (await request.get('/api/backup/export')).json()).data).toEqual(before.data);
    await assistant.getByRole('button', { name: 'Add to my notes' }).click();
    await expect(page.locator('.notes-card')).toContainText('diced sweet potato');
    await expect(assistant.getByRole('button', { name: 'Added to notes' })).toBeDisabled();
  } finally {
    await request.put('/api/settings/ai', { data: { enabled: false, baseUrl: 'http://127.0.0.1:11434', model: 'llama3.1:8b' } });
    await mock.close();
  }
});

test('mobile layout: navigation and cooking mode @mobile', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();
  const box = await nav.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 5); // pinned to the bottom
  await nav.getByRole('link', { name: 'My Recipes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Recipes' })).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
  await page.goto('/recipes/seed-overnight-oats/cook');
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await page.getByRole('button', { name: /Next/ }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
});

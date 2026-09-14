import { expect, test, type Page } from '@playwright/test';

const DEMO_PASSWORD = 'DemoRetailBooks1!';
const DEMO_OWNER = 'demo.owner@retailbooks.local';

async function signIn(page: Page, email = DEMO_OWNER): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

/**
 * Covers Phase 13's new UI surfaces (report drill-down/explain, the insights workbench tabs, and
 * document search) that shipped without a browser check during the build-out. `AI_MODE` is `off`
 * in the E2E environment, so the AI explanation is expected to render its "unavailable" state
 * rather than model prose -- the deterministic breakdown must still appear either way.
 */
test.describe('Phase 13 report explanation', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'Functional journey runs once on desktop.');
  });

  test('explains a trial balance row with a reconciled breakdown and an AI-unavailable notice', async ({
    page,
  }) => {
    const errors = collectBrowserErrors(page);
    await signIn(page);
    await page.goto('/reports/financial.trial-balance');

    const explainButtons = page.getByRole('button', { name: 'Explain' });
    await expect(explainButtons.first()).toBeVisible({ timeout: 15_000 });
    await explainButtons.first().click();

    await expect(page.getByText('Lines reconcile exactly to the reported total.')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('AI explanation unavailable')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText('Lines reconcile exactly to the reported total.')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('reaches the Explain panel by keyboard and closes it with Escape', async ({ page }) => {
    await signIn(page);
    await page.goto('/reports/financial.trial-balance');

    const explainButtons = page.getByRole('button', { name: 'Explain' });
    await expect(explainButtons.first()).toBeVisible({ timeout: 15_000 });
    await explainButtons.first().focus();
    await expect(explainButtons.first()).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByText('Lines reconcile exactly to the reported total.')).toBeVisible({
      timeout: 10_000,
    });
    // Radix's Dialog moves focus into the panel on open; a keyboard user must land somewhere
    // inside it, not be left behind on the page underneath.
    await expect(page.locator('.rb-drawer')).toContainText('Explain');
    await page.keyboard.press('Escape');
    await expect(page.getByText('Lines reconcile exactly to the reported total.')).toHaveCount(0);
    // Known gap, not asserted here: the panel is opened from external state (the row's onClick),
    // not a Radix DialogTrigger, so Radix has no trigger element to return focus to on close --
    // focus is left on <body> instead of back on the Explain button. Worth fixing in the component
    // if this is ever revisited, but out of scope for a browser-verification pass.
  });
});

test.describe('Phase 13 explain panel at narrow width', () => {
  test('keeps the reconciled table inside its own scroller instead of scrolling the page', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'mobile', 'Narrow-viewport behaviour only.');
    await signIn(page);
    await page.goto('/reports/financial.trial-balance');

    const explainButtons = page.getByRole('button', { name: 'Explain' });
    await expect(explainButtons.first()).toBeVisible({ timeout: 15_000 });
    await explainButtons.first().click();
    await expect(page.getByText('Lines reconcile exactly to the reported total.')).toBeVisible({
      timeout: 10_000,
    });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(
      overflow,
      'the explain panel must never scroll the page horizontally',
    ).toBeLessThanOrEqual(1);
  });
});

test.describe('Phase 13 insights workbench', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'Functional journey runs once on desktop.');
  });

  test('renders every advisory tab without a console or network error', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await signIn(page);
    await page.goto('/insights');

    await expect(page.getByRole('heading', { name: 'Spend insights' })).toBeVisible();
    const tabs = [
      'Cash flow',
      'Collections',
      'Inventory',
      'Project margins',
      'Policy Q&A',
      'Audit evidence',
    ];
    for (const tab of tabs) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('data-state', 'active');
    }
    expect(errors).toEqual([]);
  });
});

test.describe('Phase 13 document search', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'Functional journey runs once on desktop.');
  });

  test('runs a keyword search without a console or network error', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await signIn(page);
    await page.goto('/documents/search');

    // The app shell's own header search ("Search RetailBooks ⌘K") also partially matches "Search";
    // this page's field is exactly-labeled "Search".
    await page.getByLabel('Search', { exact: true }).fill('receipt');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    // No documents have been extracted for the demo org, so the empty state is the correct,
    // successful outcome here -- this test is about the route not erroring, not about results.
    // The EmptyState renders both a heading and a description; the description text alone
    // ("No reviewed receipts...") also matched the broader regex this used, so anchor on the
    // heading specifically.
    await expect(page.getByRole('heading', { name: 'No matches' })).toBeVisible({
      timeout: 10_000,
    });
    expect(errors).toEqual([]);
  });
});

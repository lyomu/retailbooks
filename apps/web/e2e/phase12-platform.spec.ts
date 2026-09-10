import { expect, test, type Page } from '@playwright/test';

const DEMO_PASSWORD = 'DemoRetailBooks1!';
const PLATFORM_ADMIN = 'demo.admin@retailbooks.local';
const TENANT_OWNER = 'demo.owner@retailbooks.local';

async function signIn(page: Page, email: string): Promise<void> {
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

test.describe('Phase 12 platform console', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach((_fixtures, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Platform administration runs once on desktop.');
  });

  test('keeps a signed-in tenant user outside the platform console', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await signIn(page, TENANT_OWNER);
    await page.goto('/platform');

    await expect(page.getByRole('heading', { name: 'You do not have platform access' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Platform console' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('suspends and reactivates an organization without leaving it locked out', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await signIn(page, PLATFORM_ADMIN);
    await page.goto('/platform/organizations');

    await page.getByRole('link', { name: 'Karibu Retail Demo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Karibu Retail Demo', exact: true })).toBeVisible();
    await page.getByLabel('Reason').fill('Phase 12 Playwright suspension check.');
    await page.getByRole('button', { name: 'Suspend organization' }).click();
    await expect(page.getByRole('status')).toContainText('Organization suspended.');
    await expect(page.getByRole('heading', { name: 'Suspended' })).toBeVisible();
    await expect(page.getByText('Phase 12 Playwright suspension check.')).toBeVisible();

    await page.getByLabel('Reason').fill('Phase 12 Playwright reactivation check.');
    await page.getByRole('button', { name: 'Reactivate' }).click();
    await expect(page.getByRole('status')).toContainText('Organization reactivated.');
    await expect(page.getByRole('heading', { name: 'Suspended' })).toHaveCount(0);

    await page.context().clearCookies();
    await signIn(page, TENANT_OWNER);
    expect(errors).toEqual([]);
  });

  test('targets and previews a country feature flag', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    const key = `e2e.platform.flag.${Date.now()}`;
    await signIn(page, PLATFORM_ADMIN);
    await page.goto('/platform/feature-flags');

    await page.getByLabel('Key').fill(key);
    await page.getByLabel('Name').fill('Phase 12 browser flag');
    await page.getByRole('button', { name: 'Create flag' }).click();
    await expect(page.getByRole('status')).toContainText('Feature flag created.');

    const flag = page.getByRole('region', { name: key });
    await expect(flag).toBeVisible();
    const ruleEditor = flag
      .locator('form')
      .filter({ has: flag.getByRole('button', { name: 'Save rule' }) });
    await ruleEditor.getByLabel('Scope').selectOption('COUNTRY');
    await ruleEditor.getByLabel('Country code').fill('KE');
    await ruleEditor.getByRole('button', { name: 'Save rule' }).click();
    await expect(page.getByRole('status')).toContainText('Targeting rule saved.');

    const preview = flag
      .locator('form')
      .filter({ has: flag.getByRole('button', { name: 'Preview flag' }) });
    await preview.getByLabel('Country code').fill('KE');
    await preview.getByRole('button', { name: 'Preview flag' }).click();
    await expect(flag.getByRole('status')).toContainText(/Enabled.*decided by country/i);
    expect(errors).toEqual([]);
  });
});

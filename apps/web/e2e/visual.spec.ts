import { expect, test, type Page } from '@playwright/test';

async function openStable(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.locator('#main-content').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const button = document.querySelector('button');
    return Boolean(button && Object.keys(button).some((key) => key.startsWith('__reactProps$')));
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

function collectBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => {
    errors.push(`${request.failure()?.errorText ?? 'Request failed'} ${request.url()}`);
  });
  return errors;
}

test.describe('RetailBooks design foundation', () => {
  test('@visual dashboard baseline and shell interactions', async ({ page }, testInfo) => {
    const browserErrors = collectBrowserErrors(page);
    await openStable(page, '/');
    expect(browserErrors, 'dashboard should hydrate without browser errors').toEqual([]);

    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Switch organization: RetailBooks Demo' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open profile menu for Gideon Lyomu' }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot('dashboard.png', { fullPage: true });

    if (testInfo.project.name === 'mobile') {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('dialog', { name: 'RetailBooks navigation' })).toBeVisible();
      await page.keyboard.press('Escape');
    } else if (testInfo.project.name === 'desktop') {
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
      await page.getByRole('button', { name: 'Expand sidebar' }).click();

      await page.keyboard.press('Control+K');
      await expect(page.getByPlaceholder('Search accounts, journals, reports...')).toBeFocused();
    } else {
      await page.keyboard.press('Control+K');
      await expect(page.getByPlaceholder('Search accounts, journals, reports...')).toBeFocused();
    }

    await page.getByRole('button', { name: /Preview journal/ }).click();
    await expect(page.getByRole('dialog', { name: 'New journal preview' })).toBeVisible();
    await page.getByLabel('Description').fill('Opening balance review');
    await page.getByRole('button', { name: 'Check form state' }).click();
    await expect(page.getByText('Journal form checked', { exact: true })).toBeVisible();
    expect(browserErrors).toEqual([]);
  });

  test('@visual component catalog baseline and states', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    await openStable(page, '/design-system');
    expect(browserErrors, 'component catalog should hydrate without browser errors').toEqual([]);

    await expect(page.getByRole('heading', { name: 'Design system', exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot('design-system.png', { fullPage: true });

    await page.getByRole('tab', { name: 'Empty state' }).click();
    await expect(page.getByText('No accounts match this filter', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Error state' }).click();
    await expect(page.getByText('The account list could not be loaded.')).toBeVisible();

    await page.getByRole('button', { name: 'Open dialog' }).click();
    await expect(page.getByRole('dialog', { name: 'Close fiscal period?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep open' }).click();

    await page.getByRole('button', { name: 'Test notification' }).click();
    await expect(page.getByText('Design-system notification', { exact: true })).toBeVisible();
    expect(browserErrors).toEqual([]);
  });
});

import { expect, test, type Page } from '@playwright/test';

const DEMO_PASSWORD = 'DemoRetailBooks1!';

async function login(page: Page, email = 'demo.owner@retailbooks.local'): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

test.describe('Phase 1 end-to-end journeys', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach((_fixtures, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Mutation journeys run once on desktop.');
  });

  test('identity: anti-enumerating recovery, login, and logout', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email address').fill('does-not-exist@retailbooks.local');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Reset link requested' })).toBeVisible();

    await login(page);
    await page.getByRole('button', { name: 'Open profile menu for Amina Kamau' }).click();
    await page.getByText('Sign out', { exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('onboarding: creates and finalizes a complete organization', async ({ page }) => {
    await login(page, 'demo.admin@retailbooks.local');
    await page.goto('/onboarding');

    await expect(page.getByRole('heading', { name: 'Tell us about the business' })).toBeVisible();
    await page.getByLabel('Legal or registered name').fill('Phase 1 Browser Journey Ltd');
    await page.getByLabel('Trading name').fill('Journey Books');
    await page.getByRole('button', { name: 'Create organization' }).click();

    await expect(page.getByRole('heading', { name: 'Where do you keep the books?' })).toBeVisible();
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(
      page.getByRole('heading', { name: 'How should the ledger behave?' }),
    ).toBeVisible();
    await page.getByLabel('Books start date').fill('2026-01-01');
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(page.getByRole('heading', { name: 'Tax defaults' })).toBeVisible();
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(page.getByRole('heading', { name: 'Document numbering' })).toBeVisible();
    await page.getByLabel('Journal prefix').fill('E2E');
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(page.getByRole('heading', { name: 'Invite your team' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await expect(page.getByRole('heading', { name: 'Review and finish' })).toBeVisible();
    await expect(page.getByText('Phase 1 Browser Journey Ltd', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Finish setup' }).click();

    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Switch organization. Current: Journey Books' }),
    ).toBeVisible();
  });

  test('teams: sends and withdraws an invitation', async ({ page }) => {
    await login(page);
    await page.goto('/settings/team');
    await expect(page.getByRole('heading', { name: 'Invite someone' })).toBeVisible();

    const email = 'phase1.invitee@example.test';
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Role', { exact: true }).selectOption({ label: 'Accountant' });
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByRole('status')).toContainText(`Invitation sent to ${email}.`);
    await expect(page.getByText(email, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: `Withdraw the invitation for ${email}` }).click();
    await expect(page.getByRole('status')).toContainText(`Invitation for ${email} was withdrawn.`);
    await expect(page.getByText(email, { exact: true })).toHaveCount(0);
  });

  test('periods: closes and reopens an accounting period', async ({ page }) => {
    await login(page);
    await page.goto('/periods');
    const january = page.getByRole('row').filter({ hasText: 'FY2026-P01' });
    await expect(january).toBeVisible();

    await january.getByRole('button', { name: 'Close' }).click();
    await page.getByLabel('Note (optional)').fill('Phase 1 browser acceptance');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('FY2026-P01 is now closed.');

    await january.getByRole('button', { name: 'Reopen' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Reopen' }).click();
    await expect(page.getByRole('status')).toContainText('FY2026-P01 is now open.');
  });

  test('journals: saves, posts, and reverses a balanced journal', async ({ page }) => {
    await login(page);
    await page.goto('/journals/new');
    await expect(page.getByRole('heading', { name: 'New journal' })).toBeVisible();

    await page.getByLabel('Date').fill('2026-08-24');
    await page.getByLabel('Description', { exact: true }).fill('Phase 1 browser journal');
    await page.getByLabel('Account for line 1').selectOption({ label: '1000 Cash on hand' });
    await page.getByLabel('Debit for line 1').fill('250.00');
    await page.getByLabel('Account for line 2').selectOption({ label: '3000 Owner capital' });
    await page.getByLabel('Credit for line 2').fill('250.00');
    await expect(page.getByText('Balanced', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status')).toContainText('Draft saved.');
    await page.getByRole('button', { name: 'Post' }).click();
    await expect(page.getByRole('status')).toContainText(/Posted as DEMO-/);

    await page.getByRole('button', { name: 'Reverse' }).click();
    await expect(page.getByRole('status')).toContainText(/Reversal posted as DEMO-/);
    await expect(
      page.getByText('Posted journals are immutable. Use reversal for corrections.'),
    ).toBeVisible();
  });

  test('tax: creates a code and rate, then calculates tax', async ({ page }) => {
    await login(page);
    await page.goto('/tax');
    await page.getByRole('button', { name: 'Add tax code' }).click();
    await page.getByLabel('Code', { exact: true }).fill('E2E-VAT');
    await page.getByLabel('Name', { exact: true }).fill('Browser acceptance VAT');
    await page.getByRole('button', { name: 'Save tax code' }).click();
    await expect(page.getByRole('status')).toContainText(
      'E2E-VAT Browser acceptance VAT was added.',
    );

    const row = page.getByRole('row').filter({ hasText: 'E2E-VAT Browser acceptance VAT' });
    await row.getByRole('button', { name: 'Rates' }).click();
    await expect(page.getByRole('heading', { name: 'E2E-VAT rate history' })).toBeVisible();
    await page.getByLabel('Rate percent').fill('15.5');
    await page.getByLabel('Effective from').fill('2026-01-01');
    await page.getByRole('button', { name: 'Add rate' }).click();
    await expect(
      page
        .getByRole('table', { name: 'E2E-VAT rate history' })
        .getByRole('cell', { name: '15.5%' }),
    ).toBeVisible();

    await page.getByLabel('Base amount').fill('100.00');
    await page.getByRole('button', { name: 'Calculate' }).click();
    await expect(page.getByText('KES 15.50', { exact: true })).toBeVisible();
    await expect(page.getByText('KES 115.50', { exact: true })).toBeVisible();
  });
});

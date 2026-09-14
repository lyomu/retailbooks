import { expect, test, type Page } from '@playwright/test';

import {
  apiGet,
  apiPatch,
  apiPost,
  apiUploadFile,
  findAccountIdByName,
  getActiveOrganization,
  getActiveOrganizationId,
} from './lib/api-fixtures';
import { renderReceiptPng } from './lib/receipt-image';

const DEMO_PASSWORD = 'DemoRetailBooks1!';
const DEMO_OWNER = 'demo.owner@retailbooks.local';

async function signIn(page: Page, email = DEMO_OWNER): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

/**
 * These four surfaces have zero coverage in the demo seed data (no bank transactions, approval
 * requests, AI suggestions, or document extractions are seeded -- see
 * apps/api/src/demo-seed.service.ts), so each test seeds its own real backend state via direct API
 * calls (`page.request` shares the session cookie the UI sign-in set, since the web app itself
 * talks straight to this same origin -- see apps/web/src/lib/api.ts) before exercising the
 * relevant UI. The document-extraction tests additionally depend on the `document-extraction`
 * BullMQ worker actually running in this environment, which it did not before this pass -- see
 * apps/web/e2e/prepare.mjs's `startDocumentExtractionWorker`.
 */

test.describe('Phase 13 document extraction review panel', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'Functional journey runs once on desktop.');
  });

  test('accepts a ready candidate and copies its values into the draft', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const organizationId = await getActiveOrganizationId(page);
    const bankAccountId = await findAccountIdByName(page, organizationId, 'Bank account - operating');

    const expense = await apiPost<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/expenses`,
      {
        payeeName: 'Extraction Accept Vendor',
        expenseDate: '2026-03-01',
        paidThroughAccountId: bankAccountId,
        amountMinor: '110000',
      },
    );

    await page.goto(`/expenses/${expense.data.id}`);

    const receipt = renderReceiptPng([
      'Acme Testing Co',
      'Date: 2026-03-01',
      'Subtotal 1000.00',
      'VAT 100.00',
      'Total 1100.00',
    ]);
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: receipt });
    await expect(page.getByText('Receipt uploaded.')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Review' }).click();
    // The panel polls every 3s for up to 60s while the real ClamAV scan and tesseract OCR run.
    await expect(page.getByRole('button', { name: 'Use these values' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('Subtotal + tax reconciles')).toBeVisible();

    await page.getByRole('button', { name: 'Use these values' }).click();
    await expect(page.getByText('Values used')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText('Candidate values copied into the draft. Review them, then save.'),
    ).toBeVisible();
  });

  test('dismisses a ready candidate without touching the draft', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const organizationId = await getActiveOrganizationId(page);
    const bankAccountId = await findAccountIdByName(page, organizationId, 'Bank account - operating');

    const expense = await apiPost<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/expenses`,
      {
        payeeName: 'Extraction Dismiss Vendor',
        expenseDate: '2026-03-02',
        paidThroughAccountId: bankAccountId,
        amountMinor: '55000',
      },
    );

    await page.goto(`/expenses/${expense.data.id}`);

    const receipt = renderReceiptPng([
      'Zenith Testing Ltd',
      'Date: 2026-03-02',
      'Subtotal 500.00',
      'VAT 50.00',
      'Total 550.00',
    ]);
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: receipt });
    await expect(page.getByText('Receipt uploaded.')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Review' }).click();
    await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText('Dismissed')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Phase 13 document discrepancy detection', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'Functional journey runs once on desktop.');
  });

  test('flags a receipt total that does not match the recorded expense amount', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const organizationId = await getActiveOrganizationId(page);
    const bankAccountId = await findAccountIdByName(page, organizationId, 'Bank account - operating');

    // Recorded at 500.00; the receipt below reads 1,100.00 -- a deliberate mismatch.
    const expense = await apiPost<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/expenses`,
      {
        payeeName: 'Discrepancy Vendor',
        expenseDate: '2026-03-05',
        paidThroughAccountId: bankAccountId,
        amountMinor: '50000',
      },
    );

    const receipt = renderReceiptPng([
      'Discrepancy Testing Co',
      'Date: 2026-03-05',
      'Subtotal 1000.00',
      'VAT 100.00',
      'Total 1100.00',
    ]);
    const uploaded = await apiUploadFile<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/expenses/${expense.data.id}/attachments`,
      'receipt.png',
      receipt,
      'image/png',
    );

    // Poll the API directly (not the panel's own 3s UI cadence) for the extraction to finish.
    await expect
      .poll(
        async () => {
          const detail = await apiGet<{ data: { status: string } | null }>(
            page,
            `/organizations/${organizationId}/expenses/${expense.data.id}/attachments/${uploaded.data.id}/extraction`,
          );
          return detail.data?.status ?? null;
        },
        { timeout: 60_000, intervals: [2_000] },
      )
      .toBe('READY_FOR_REVIEW');

    await page.goto(`/expenses/${expense.data.id}`);
    await expect(page.getByText('Document discrepancies')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('Receipt shows 110000 minor units; the expense records 50000.'),
    ).toBeVisible();
  });
});

test.describe('Phase 13 bank match proposals', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'Functional journey runs once on desktop.');
  });

  test('ranks a real match candidate and fills the match form when selected', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const organization = await getActiveOrganization(page);
    const organizationId = organization.id;
    const bankGlAccountId = await findAccountIdByName(page, organizationId, 'Bank account - operating');

    const financialAccount = await apiPost<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/financial-accounts`,
      {
        name: 'E2E Operating Checking',
        type: 'BANK',
        currency: organization.baseCurrency,
        glAccountId: bankGlAccountId,
      },
    );

    const vendor = await apiPost<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/vendors`,
      { displayName: 'Match Proposal Vendor' },
    );

    const expense = await apiPost<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/expenses`,
      {
        payeeVendorId: vendor.data.id,
        expenseDate: '2026-03-10',
        paidThroughAccountId: bankGlAccountId,
        amountMinor: '75000',
      },
    );
    await apiPost(page, `/organizations/${organizationId}/expenses/${expense.data.id}/post`, {});

    const csv = 'date,description,amount\n2026-03-11,MATCH PROPOSAL VENDOR PAYMENT,-750.00\n';
    await apiUploadFile(
      page,
      `/organizations/${organizationId}/statement-imports`,
      'statement.csv',
      Buffer.from(csv, 'utf8'),
      'text/csv',
      { financialAccountId: financialAccount.data.id },
    );

    await page.goto('/bank-transactions');
    await page.getByRole('button', { name: 'Match' }).first().click();
    await expect(page.getByText('Suggested matches')).toBeVisible({ timeout: 15_000 });

    const proposalButton = page.getByRole('button').filter({ hasText: 'Match Proposal Vendor' });
    await expect(proposalButton).toBeVisible();
    await expect(proposalButton).toContainText('exact amount match');
    await proposalButton.click();
    await expect(page.getByLabel('Target id')).toHaveValue(expense.data.id);
  });
});

test.describe('Phase 13 approval briefing', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'Functional journey runs once on desktop.');
  });

  test('shows what changed on a Bill since it was submitted for approval', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const organizationId = await getActiveOrganizationId(page);
    const expenseAccountId = await findAccountIdByName(page, organizationId, 'Miscellaneous expense');

    const vendorA = await apiPost<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/vendors`,
      { displayName: 'Briefing Vendor A' },
    );
    const vendorB = await apiPost<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/vendors`,
      { displayName: 'Briefing Vendor B' },
    );

    const policy = await apiPost<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/automation/approval-policies`,
      {
        name: 'E2E bill review policy',
        targetType: 'BILL',
        conditions: { minimumAmountMinor: '1' },
        steps: [{ requiredPermission: 'purchases.bills.manage', label: 'Finance review' }],
      },
    );
    await apiPost(
      page,
      `/organizations/${organizationId}/automation/approval-policies/${policy.data.id}/activate`,
      {},
    );

    const bill = await apiPost<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/bills`,
      {
        vendorId: vendorA.data.id,
        lines: [
          {
            description: 'Consulting services',
            quantity: '1',
            unitPriceMinor: '250000',
            accountId: expenseAccountId,
          },
        ],
      },
    );

    await apiPost(page, `/organizations/${organizationId}/automation/approval-requests`, {
      targetType: 'BILL',
      targetId: bill.data.id,
    });

    // Editing a DRAFT bill is allowed even while an approval request is pending review (only
    // issue/void are blocked) -- this is exactly the drift the briefing exists to surface.
    await apiPatch(page, `/organizations/${organizationId}/bills/${bill.data.id}`, {
      vendorId: vendorB.data.id,
    });

    await page.goto('/approvals');
    await page.getByRole('tab', { name: 'Submitted by me' }).click();
    // The row's own label is frozen from the submission-time snapshot, so it still reads
    // "Briefing Vendor A" even after the PATCH above -- that's the point being tested.
    await page.getByRole('button').filter({ hasText: 'Briefing Vendor A' }).click();

    await expect(page.getByText('Briefing')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Changed since submission: vendorName')).toBeVisible();
    await expect(page.getByText('Amount at least 1 minor units')).toBeVisible();
  });
});

test.describe('Phase 13 categorization suggestion', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'Functional journey runs once on desktop.');
  });

  test("offers a category suggestion from the vendor's prior posted expense", async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const organizationId = await getActiveOrganizationId(page);
    const bankAccountId = await findAccountIdByName(page, organizationId, 'Bank account - operating');
    const expenseAccountId = await findAccountIdByName(page, organizationId, 'Miscellaneous expense');

    const vendor = await apiPost<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/vendors`,
      { displayName: 'Suggestion Vendor' },
    );
    const category = await apiPost<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/expense-categories`,
      { name: 'Office Supplies E2E', accountId: expenseAccountId },
    );

    const priorExpense = await apiPost<{ data: { id: string } }>(
      page,
      `/organizations/${organizationId}/expenses`,
      {
        payeeVendorId: vendor.data.id,
        expenseDate: '2026-02-01',
        paidThroughAccountId: bankAccountId,
        categoryId: category.data.id,
        amountMinor: '10000',
      },
    );
    await apiPost(
      page,
      `/organizations/${organizationId}/expenses/${priorExpense.data.id}/post`,
      {},
    );

    await page.goto('/expenses/new');
    await page.getByLabel('Vendor').selectOption({ label: 'Suggestion Vendor' });

    await expect(page.getByText('Suggested: Office Supplies E2E')).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Use this category' }).click();
    await expect(page.getByLabel('Category')).toHaveValue(category.data.id);
  });
});

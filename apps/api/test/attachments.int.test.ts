import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { BillsService } from '../src/purchases/bills.service.js';
import { ExpensesService } from '../src/purchases/expenses.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'attachments-test',
  userAgent: 'RetailBooks integration test',
};

describe('attachments (Bills and Expenses nested routes) against a real database and MinIO', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let vendors: VendorsService;
  let bills: BillsService;
  let expenses: ExpensesService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let cookie: string;
  let vendorId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    vendors = harness.app.get(VendorsService);
    bills = harness.app.get(BillsService);
    expenses = harness.app.get(ExpensesService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'attachments-owner@example.test',
        displayName: 'Attachments Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    owner = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };
    const created = await organizations.create(
      owner,
      { legalName: 'Attachment Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const vendor = await vendors.create(context, owner, { displayName: 'Acme Supplies' }, metadata);
    vendorId = vendor.id;
    cookie = await sessionCookieFor(owner.id);
  });

  async function createBill() {
    return bills.createDraft(
      context,
      owner,
      { vendorId, lines: [{ description: 'Widget stock', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
  }

  async function createExpense() {
    const bankAccount = await ledger.accountBySystemKey(context.id, 'bank_default');
    return expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Cash purchase',
        expenseDate: '2026-02-01',
        paidThroughAccountId: bankAccount.id,
        amountMinor: '500',
      },
      metadata,
    );
  }

  it('uploads and lists a Bill attachment via the nested HTTP route, round-tripping real bytes through MinIO', async () => {
    const bill = await createBill();
    const content = Buffer.from('This is a receipt for widget stock.', 'utf8');

    const uploadResponse = await harness
      .http()
      .post(`${API}/organizations/${context.id}/bills/${bill.id}/attachments`)
      .set('Cookie', cookie)
      .attach('file', content, { filename: 'receipt.txt', contentType: 'text/plain' })
      .expect(201);

    const uploaded = (
      uploadResponse.body as {
        data: { id: string; filename: string; contentType: string; sizeBytes: number };
      }
    ).data;
    expect(uploaded.filename).toBe('receipt.txt');
    expect(uploaded.contentType).toBe('text/plain');
    expect(uploaded.sizeBytes).toBe(content.length);

    const listResponse = await harness
      .http()
      .get(`${API}/organizations/${context.id}/bills/${bill.id}/attachments`)
      .set('Cookie', cookie)
      .expect(200);

    const list = (
      listResponse.body as {
        data: {
          id: string;
          filename: string;
          contentType: string;
          sizeBytes: number;
          downloadUrl: string;
        }[];
      }
    ).data;
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(uploaded.id);
    expect(list[0]?.filename).toBe('receipt.txt');
    expect(list[0]?.contentType).toBe('text/plain');
    expect(list[0]?.sizeBytes).toBe(content.length);

    // Confirm StorageService actually wrote to (real, running) MinIO -- not a no-op -- by fetching
    // the signed download URL and checking the round-tripped bytes match what was uploaded.
    expect(list[0]?.downloadUrl).toMatch(/^https?:\/\//);
    const stored = await fetch(list[0]!.downloadUrl);
    expect(stored.status).toBe(200);
    const storedBytes = Buffer.from(await stored.arrayBuffer());
    expect(storedBytes.equals(content)).toBe(true);

    const dbRecord = await harness.prisma.attachment.findUniqueOrThrow({
      where: { id: uploaded.id },
    });
    expect(dbRecord.storageKey.length).toBeGreaterThan(0);
    expect(dbRecord.storageKey).toContain(`${context.id}/bill/${bill.id}/`);
    expect(dbRecord.entityType).toBe('BILL');
    expect(dbRecord.entityId).toBe(bill.id);
  });

  it('uploads and lists an Expense attachment via the nested HTTP route', async () => {
    const expense = await createExpense();
    const content = Buffer.from('Expense receipt image bytes', 'utf8');

    const uploadResponse = await harness
      .http()
      .post(`${API}/organizations/${context.id}/expenses/${expense.id}/attachments`)
      .set('Cookie', cookie)
      .attach('file', content, { filename: 'expense-receipt.png', contentType: 'image/png' })
      .expect(201);

    const uploaded = (uploadResponse.body as { data: { id: string; filename: string } }).data;
    expect(uploaded.filename).toBe('expense-receipt.png');

    const listResponse = await harness
      .http()
      .get(`${API}/organizations/${context.id}/expenses/${expense.id}/attachments`)
      .set('Cookie', cookie)
      .expect(200);

    const list = (listResponse.body as { data: { id: string; contentType: string }[] }).data;
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(uploaded.id);
    expect(list[0]?.contentType).toBe('image/png');

    const dbRecord = await harness.prisma.attachment.findUniqueOrThrow({
      where: { id: uploaded.id },
    });
    expect(dbRecord.entityType).toBe('EXPENSE');
    expect(dbRecord.entityId).toBe(expense.id);
  });

  it('rejects an upload over the 15MB size limit and persists no attachment record', async () => {
    const bill = await createBill();
    const oversized = Buffer.alloc(15 * 1024 * 1024 + 1);

    // The limit is enforced at the interceptor, so the body is refused mid-stream rather than
    // buffered in full and measured afterwards. That makes 413 the honest status: the request was
    // never processed, which a 400 would imply it had been.
    const response = await harness
      .http()
      .post(`${API}/organizations/${context.id}/bills/${bill.id}/attachments`)
      .set('Cookie', cookie)
      .attach('file', oversized, {
        filename: 'too-big.bin',
        contentType: 'application/octet-stream',
      })
      .expect(413);

    expect((response.body as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE');

    expect(
      await harness.prisma.attachment.count({
        where: { organizationId: context.id, entityType: 'BILL', entityId: bill.id },
      }),
    ).toBe(0);
  }, 30_000);

  it('scopes attachments to the entity they were uploaded against: another Bill sees none of them', async () => {
    const billA = await createBill();
    const billB = await createBill();

    await harness
      .http()
      .post(`${API}/organizations/${context.id}/bills/${billA.id}/attachments`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from('bill A receipt', 'utf8'), { filename: 'a.txt' })
      .expect(201);

    const listAResponse = await harness
      .http()
      .get(`${API}/organizations/${context.id}/bills/${billA.id}/attachments`)
      .set('Cookie', cookie)
      .expect(200);
    expect((listAResponse.body as { data: unknown[] }).data).toHaveLength(1);

    const listBResponse = await harness
      .http()
      .get(`${API}/organizations/${context.id}/bills/${billB.id}/attachments`)
      .set('Cookie', cookie)
      .expect(200);
    expect((listBResponse.body as { data: unknown[] }).data).toHaveLength(0);
  });

  async function sessionCookieFor(userId: string): Promise<string> {
    const rawToken = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `rb_session=${rawToken}`;
  }
});

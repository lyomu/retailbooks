import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, type PortalInvitationStatus } from '@prisma/client';

import { AuthMailerService } from '../auth/auth-mailer.service.js';
import type { PublicUser } from '../auth/auth.service.js';
import { createOpaqueToken, hashToken } from '../auth/auth.crypto.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { StatementsService } from '../sales/statements.service.js';
import { DocumentRenderingService } from '../sales/document-rendering.service.js';
import { parsePdfRenderSnapshot } from '../sales/pdf-render-snapshot.js';
import type { PortalContext } from './portal-context.js';
import type { UpdatePortalProfileDto } from './portal.dto.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CRLF = '\r\n';

/**
 * The only line shape the portal ever projects, shared by every customer-eligible document. The
 * money and quantity columns are Prisma Decimal/BigInt values, so they are carried as their string
 * forms rather than converted to a JavaScript number anywhere on the way out.
 */
interface DocumentLine {
  descriptionSnapshot: string;
  quantity: { toString(): string };
  unitPriceMinor: { toString(): string };
  discountMinor: { toString(): string };
  lineTotalMinor: { toString(): string };
}

/** A customer-eligible document, normalised across the five models the portal can expose. */
interface PortalDocumentRecord {
  id: string;
  number: string | null;
  status: string;
  issueDate: Date | null;
  dueDate?: Date | null;
  currency: string;
  totalMinor?: bigint;
  amountMinor?: bigint;
  lines?: DocumentLine[];
  /** The frozen render payload (Invoice/CreditNote/Quote only) when the document was issued or
   * approved; absent for SalesOrders/PaymentReceived. Renders from this, never from live records. */
  pdfSnapshot?: unknown;
}

/** One row of the document list, before it is serialised. */
interface DocumentSummarySource {
  id: string;
  status: string;
  currency: string;
  issueDate?: Date | null;
  dueDate?: Date | null;
  totalMinor?: bigint;
  amountMinor?: bigint;
}
const CSV_QUOTED = /[",\r\n]/;

@Injectable()
export class PortalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: AuthMailerService,
    private readonly statements: StatementsService,
    private readonly documentRendering: DocumentRenderingService,
  ) {}

  async listInternal(organizationId: string, contactId: string) {
    await this.customer(organizationId, contactId);
    const db = this.prisma;
    const [users, invitations] = await Promise.all([
      db.portalUser.findMany({
        where: { organizationId, contactId },
        include: { user: { select: { email: true, displayName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      db.portalInvitation.findMany({
        where: { organizationId, contactId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      users: users.map((grant) => ({
        id: grant.id,
        email: grant.user.email,
        displayName: grant.user.displayName,
        status: grant.status,
        activatedAt: grant.activatedAt.toISOString(),
        revokedAt: grant.revokedAt?.toISOString() ?? null,
      })),
      invitations: invitations.map(summarizeInvitation),
    };
  }

  async invite(context: OrganizationContext, actor: PublicUser, contactId: string, email: string) {
    const contact = await this.customer(context.id, contactId);
    const normalized = email.trim().toLowerCase();
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const invitation = await this.prisma.$transaction(async (tx) => {
      // Superseding any live invitation to the same address keeps exactly one redeemable token per
      // (customer, email) pair, so a resend cannot leave an older link working.
      await tx.portalInvitation.updateMany({
        where: { organizationId: context.id, contactId, email: normalized, status: 'PENDING' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      const created = await tx.portalInvitation.create({
        data: {
          organizationId: context.id,
          contactId,
          email: normalized,
          tokenHash: hashToken(token),
          invitedByUserId: actor.id,
          expiresAt,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: actor.id,
        eventKey: 'portal.invitation_sent',
        entityType: 'contact',
        entityId: contactId,
        action: AuditAction.CREATE,
        after: { invitationId: created.id, email: normalized },
        ipHash: null,
      });
      return created;
    });
    await this.mailer.sendPortalInvitation({
      email: normalized,
      organizationName: context.legalName,
      customerName: contact.displayName,
      inviterName: actor.displayName,
      token,
      expiresAt,
    });
    return summarizeInvitation(invitation);
  }

  async resend(context: OrganizationContext, actor: PublicUser, invitationId: string) {
    const db = this.prisma;
    const previous = await db.portalInvitation.findFirst({
      where: { id: invitationId, organizationId: context.id, status: 'PENDING' },
      include: { contact: { select: { displayName: true } } },
    });
    if (!previous || previous.expiresAt <= new Date())
      throw new NotFoundException('Portal invitation not found.');
    return this.invite(context, actor, previous.contactId, previous.email);
  }

  async revokeInvitation(organizationId: string, invitationId: string) {
    const result = await this.prisma.portalInvitation.updateMany({
      where: { id: invitationId, organizationId, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (result.count !== 1) throw new NotFoundException('Portal invitation not found.');
  }

  async revokeUser(organizationId: string, portalUserId: string) {
    const result = await this.prisma.portalUser.updateMany({
      where: { id: portalUserId, organizationId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (result.count !== 1) throw new NotFoundException('Portal user not found.');
  }

  async preview(token: string) {
    const invitation = await this.findUsableInvitation(token);
    return {
      organizationName: invitation.organization.tradingName ?? invitation.organization.legalName,
      customerName: invitation.contact.displayName,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async accept(token: string, user: PublicUser) {
    if (!user.emailVerified)
      throw new ConflictException('Verify your email before accepting a portal invitation.');
    const invitation = await this.findUsableInvitation(token);
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new NotFoundException('Portal invitation not found.');
    }
    const grant = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.portalInvitation.updateMany({
        where: { id: invitation.id, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedByUserId: user.id },
      });
      if (consumed.count !== 1) throw new NotFoundException('Portal invitation not found.');
      const existing = await tx.portalUser.findUnique({
        where: {
          organizationId_contactId_userId: {
            organizationId: invitation.organizationId,
            contactId: invitation.contactId,
            userId: user.id,
          },
        },
      });
      const portalUser = existing
        ? await tx.portalUser.update({
            where: { id: existing.id },
            data: { status: 'ACTIVE', revokedAt: null, activatedAt: new Date() },
          })
        : await tx.portalUser.create({
            data: {
              organizationId: invitation.organizationId,
              contactId: invitation.contactId,
              userId: user.id,
              invitedByUserId: invitation.invitedByUserId,
            },
          });
      await tx.portalInvitation.update({
        where: { id: invitation.id },
        data: { portalUserId: portalUser.id },
      });
      await writeAuditEvent(tx, {
        organizationId: invitation.organizationId,
        actorUserId: user.id,
        eventKey: 'portal.invitation_accepted',
        entityType: 'contact',
        entityId: invitation.contactId,
        action: AuditAction.UPDATE,
        after: { portalUserId: portalUser.id },
        ipHash: null,
      });
      return portalUser;
    });
    return { id: grant.id };
  }

  async accounts(userId: string) {
    const grants = await this.prisma.portalUser.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        organization: { select: { legalName: true, tradingName: true } },
        contact: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return grants.map((grant) => ({
      id: grant.id,
      organizationName: grant.organization.tradingName ?? grant.organization.legalName,
      customerName: grant.contact.displayName,
    }));
  }

  async documents(portal: PortalContext, type?: string) {
    const db = this.prisma;
    const rows: Array<ReturnType<typeof documentSummary>> = [];
    const eligible = !type || type === 'QUOTE';
    if (eligible)
      rows.push(
        ...(
          await db.quote.findMany({
            where: {
              organizationId: portal.organizationId,
              contactId: portal.contactId,
              sentAt: { not: null },
            },
            orderBy: { sentAt: 'desc' },
            select: {
              id: true,
              quoteNumber: true,
              status: true,
              issueDate: true,
              expiryDate: true,
              currency: true,
              totalMinor: true,
              sentAt: true,
            },
          })
        ).map((item) => documentSummary('QUOTE', item, item.quoteNumber, item.sentAt)),
      );
    if (!type || type === 'SALES_ORDER')
      rows.push(
        ...(
          await db.salesOrder.findMany({
            where: {
              organizationId: portal.organizationId,
              contactId: portal.contactId,
              portalVisibleAt: { not: null },
            },
            orderBy: { portalVisibleAt: 'desc' },
            select: {
              id: true,
              orderNumber: true,
              status: true,
              issueDate: true,
              currency: true,
              totalMinor: true,
              portalVisibleAt: true,
            },
          })
        ).map((item) =>
          documentSummary('SALES_ORDER', item, item.orderNumber, item.portalVisibleAt),
        ),
      );
    if (!type || type === 'INVOICE')
      rows.push(
        ...(
          await db.invoice.findMany({
            where: {
              organizationId: portal.organizationId,
              contactId: portal.contactId,
              issueDate: { not: null },
              status: { not: 'DRAFT' },
            },
            orderBy: { issueDate: 'desc' },
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              issueDate: true,
              dueDate: true,
              currency: true,
              totalMinor: true,
            },
          })
        ).map((item) => documentSummary('INVOICE', item, item.invoiceNumber, item.issueDate)),
      );
    if (!type || type === 'CREDIT_NOTE')
      rows.push(
        ...(
          await db.creditNote.findMany({
            where: {
              organizationId: portal.organizationId,
              contactId: portal.contactId,
              issueDate: { not: null },
              status: { not: 'DRAFT' },
            },
            orderBy: { issueDate: 'desc' },
            select: {
              id: true,
              creditNoteNumber: true,
              status: true,
              issueDate: true,
              currency: true,
              totalMinor: true,
            },
          })
        ).map((item) =>
          documentSummary('CREDIT_NOTE', item, item.creditNoteNumber, item.issueDate),
        ),
      );
    if (!type || type === 'PAYMENT_RECEIVED')
      rows.push(
        ...(
          await db.paymentReceived.findMany({
            where: { organizationId: portal.organizationId, contactId: portal.contactId },
            orderBy: { receivedDate: 'desc' },
            select: {
              id: true,
              paymentNumber: true,
              status: true,
              receivedDate: true,
              currency: true,
              amountMinor: true,
            },
          })
        ).map((item) =>
          documentSummary('PAYMENT_RECEIVED', item, item.paymentNumber, item.receivedDate),
        ),
      );
    return rows.sort((a, b) => b.exposedAt.localeCompare(a.exposedAt));
  }

  async document(portal: PortalContext, type: string, id: string) {
    const record = await this.portalDocumentRecord(portal, type, id);
    if (!record) throw new NotFoundException('Portal document not found.');
    // The field selection deliberately excludes journals, accounts, tax/accounting snapshots, costs,
    // approval state, and internal notes. Lines are customer-facing descriptions and quantities only.
    return {
      id: record.id,
      type,
      number: record.number,
      status: record.status,
      issueDate: record.issueDate?.toISOString() ?? null,
      dueDate: record.dueDate?.toISOString() ?? null,
      currency: record.currency,
      totalMinor: String(record.totalMinor ?? record.amountMinor),
      lines: (record.lines ?? []).map((line) => ({
        description: line.descriptionSnapshot,
        quantity: String(line.quantity),
        unitPriceMinor: String(line.unitPriceMinor),
        discountMinor: String(line.discountMinor),
        totalMinor: String(line.lineTotalMinor),
      })),
    };
  }

  async decideQuote(portal: PortalContext, quoteId: string, decision: 'ACCEPTED' | 'DECLINED') {
    const changed = await this.prisma.$transaction(async (tx) => {
      const update = await tx.quote.updateMany({
        where: {
          id: quoteId,
          organizationId: portal.organizationId,
          contactId: portal.contactId,
          status: 'SENT',
          sentAt: { not: null },
        },
        data: { status: decision },
      });
      if (update.count !== 1) throw new NotFoundException('Portal document not found.');
      await writeAuditEvent(tx, {
        organizationId: portal.organizationId,
        actorUserId: portal.userId,
        eventKey: decision === 'ACCEPTED' ? 'portal.quote_accepted' : 'portal.quote_declined',
        entityType: 'quote',
        entityId: quoteId,
        action: AuditAction.UPDATE,
        after: { status: decision, portalUserId: portal.id },
        ipHash: null,
        // The customer performed this, so the projected activity row belongs on their timeline too.
        portalUserId: portal.id,
      });
      return tx.quote.findUnique({ where: { id: quoteId }, select: { id: true, status: true } });
    });
    return changed;
  }

  async profile(portal: PortalContext) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: portal.contactId, organizationId: portal.organizationId, type: 'CUSTOMER' },
      select: PROFILE_SELECT,
    });
    if (!contact) throw new NotFoundException('Portal account not found.');
    return projectProfile(contact);
  }

  async updateProfile(portal: PortalContext, input: UpdatePortalProfileDto) {
    if (input.addresses) assertOneDefaultPerKind(input.addresses);
    const before = await this.profile(portal);
    return this.prisma.$transaction(async (tx) => {
      // Scoped by organization as well as id: PortalContext already pins both, and re-stating the
      // tenant on the read keeps it correct even if that context is ever built another way.
      // Existence is established by this read rather than by an update count -- an addresses-only
      // save changes no scalar column, and inferring "not found" from an empty update turned that
      // perfectly valid request into a 404.
      const existing = await tx.contact.findFirst({
        where: { id: portal.contactId, organizationId: portal.organizationId, type: 'CUSTOMER' },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Portal account not found.');
      const scalars = {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        // Only the customer-facing contact email. The portal user's sign-in email lives on `User`
        // and is deliberately unreachable from this endpoint.
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      };
      if (Object.keys(scalars).length > 0) {
        await tx.contact.update({ where: { id: portal.contactId }, data: scalars });
      }
      if (input.addresses) {
        await tx.contactAddress.deleteMany({
          where: { organizationId: portal.organizationId, contactId: portal.contactId },
        });
        for (const address of input.addresses) {
          await tx.contactAddress.create({
            data: {
              organizationId: portal.organizationId,
              contactId: portal.contactId,
              kind: address.kind,
              line1: address.line1,
              line2: address.line2 ?? null,
              city: address.city ?? null,
              region: address.region ?? null,
              postalCode: address.postalCode ?? null,
              countryCode: address.countryCode,
              isDefault: Boolean(address.isDefault),
            },
          });
        }
      }
      const contact = await tx.contact.findFirstOrThrow({
        where: { id: portal.contactId, organizationId: portal.organizationId },
        select: PROFILE_SELECT,
      });
      const after = projectProfile(contact);
      await writeAuditEvent(tx, {
        organizationId: portal.organizationId,
        actorUserId: portal.userId,
        eventKey: 'portal.profile_updated',
        entityType: 'contact',
        entityId: portal.contactId,
        action: AuditAction.UPDATE,
        before,
        after,
        ipHash: null,
        portalUserId: portal.id,
      });
      return after;
    });
  }

  async statement(portal: PortalContext, query: { from?: string; to?: string }) {
    // Statement derivation is shared with the internal endpoint, but the only identifiers supplied
    // come from PortalContext rather than request input.
    return this.statements.getStatement(portal.organizationId, portal.contactId, query);
  }

  /**
   * The same derived statement the customer sees on screen, serialised as CSV. Rendering the export
   * from the identical projection is what keeps a downloaded file and the visible table from ever
   * disagreeing -- the export is a format, not a second derivation.
   */
  async statementCsv(portal: PortalContext, query: { from?: string; to?: string }) {
    const statement = await this.statement(portal, query);
    const rows: string[][] = [
      ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
      ...statement.transactions.map((transaction) => [
        transaction.date,
        transaction.description,
        minorToDecimal(transaction.debitMinor),
        minorToDecimal(transaction.creditMinor),
        minorToDecimal(transaction.balanceMinor),
      ]),
      [],
      ['Opening balance', '', '', '', minorToDecimal(statement.summary.openingBalanceMinor)],
      ['Closing balance', '', '', '', minorToDecimal(statement.summary.closingBalanceMinor)],
    ];
    const slug = statement.contact.displayName.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    return {
      filename: `statement-${slug}-${statement.to}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: rows.map((row) => row.map(csvCell).join(',')).join(CRLF),
    };
  }

  async downloadDocument(portal: PortalContext, type: string, id: string) {
    const record = await this.portalDocumentRecord(portal, type, id);
    if (!record) throw new NotFoundException('Portal document not found.');
    const renderingType = type as
      'QUOTE' | 'SALES_ORDER' | 'INVOICE' | 'CREDIT_NOTE' | 'PAYMENT_RECEIVED';
    // Issued documents render from the frozen pdfSnapshot (GAPS #38); only documents that predate
    // snapshots fall back to the live portal/organization display values.
    const frozen = parsePdfRenderSnapshot(record.pdfSnapshot);
    const snapshot = await this.documentRendering.render(
      portal.organizationId,
      renderingType,
      id,
      customerDocumentHtml({
        organizationName: frozen?.organizationName ?? portal.organizationName,
        customerName: frozen?.contactName ?? portal.contactName,
        type,
        number: record.number,
        status: record.status,
        currency: record.currency,
        totalMinor: frozen?.totalMinor ?? String(record.totalMinor ?? record.amountMinor),
        lines: frozen?.lines ?? record.lines ?? [],
      }),
    );
    return { downloadUrl: await this.documentRendering.getSignedUrl(snapshot.storageKey) };
  }

  private async customer(organizationId: string, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId, type: 'CUSTOMER' },
      select: { id: true, displayName: true },
    });
    if (!contact) throw new NotFoundException('Customer not found.');
    return contact;
  }

  private async findUsableInvitation(token: string) {
    const db = this.prisma;
    const invitation = await db.portalInvitation.findFirst({
      where: { tokenHash: hashToken(token), status: 'PENDING', expiresAt: { gt: new Date() } },
      include: {
        organization: { select: { legalName: true, tradingName: true } },
        contact: { select: { displayName: true } },
      },
    });
    if (!invitation) throw new NotFoundException('Portal invitation not found.');
    return invitation;
  }

  private async portalDocumentRecord(
    portal: PortalContext,
    type: string,
    id: string,
  ): Promise<PortalDocumentRecord | null> {
    const db = this.prisma;
    const base = { id, organizationId: portal.organizationId, contactId: portal.contactId };
    switch (type) {
      case 'QUOTE':
        return db.quote
          .findFirst({
            where: { ...base, sentAt: { not: null } },
            select: {
              id: true,
              quoteNumber: true,
              status: true,
              issueDate: true,
              expiryDate: true,
              currency: true,
              totalMinor: true,
              pdfSnapshot: true,
              lines: {
                select: {
                  descriptionSnapshot: true,
                  quantity: true,
                  unitPriceMinor: true,
                  discountMinor: true,
                  lineTotalMinor: true,
                },
              },
            },
          })
          .then((row) => row && { ...row, number: row.quoteNumber, dueDate: row.expiryDate });
      case 'SALES_ORDER':
        return db.salesOrder
          .findFirst({
            where: { ...base, portalVisibleAt: { not: null } },
            select: {
              id: true,
              orderNumber: true,
              status: true,
              issueDate: true,
              currency: true,
              totalMinor: true,
              lines: {
                select: {
                  descriptionSnapshot: true,
                  quantity: true,
                  unitPriceMinor: true,
                  discountMinor: true,
                  lineTotalMinor: true,
                },
              },
            },
          })
          .then((row) => row && { ...row, number: row.orderNumber });
      case 'INVOICE':
        return db.invoice
          .findFirst({
            where: { ...base, issueDate: { not: null }, status: { not: 'DRAFT' } },
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              issueDate: true,
              dueDate: true,
              currency: true,
              totalMinor: true,
              pdfSnapshot: true,
              lines: {
                select: {
                  descriptionSnapshot: true,
                  quantity: true,
                  unitPriceMinor: true,
                  discountMinor: true,
                  lineTotalMinor: true,
                },
              },
            },
          })
          .then((row) => row && { ...row, number: row.invoiceNumber });
      case 'CREDIT_NOTE':
        return db.creditNote
          .findFirst({
            where: { ...base, issueDate: { not: null }, status: { not: 'DRAFT' } },
            select: {
              id: true,
              creditNoteNumber: true,
              status: true,
              issueDate: true,
              currency: true,
              totalMinor: true,
              pdfSnapshot: true,
              lines: {
                select: {
                  descriptionSnapshot: true,
                  quantity: true,
                  unitPriceMinor: true,
                  discountMinor: true,
                  lineTotalMinor: true,
                },
              },
            },
          })
          .then((row) => row && { ...row, number: row.creditNoteNumber });
      case 'PAYMENT_RECEIVED':
        return db.paymentReceived
          .findFirst({
            where: base,
            select: {
              id: true,
              paymentNumber: true,
              status: true,
              receivedDate: true,
              currency: true,
              amountMinor: true,
            },
          })
          .then((row) => row && { ...row, number: row.paymentNumber, issueDate: row.receivedDate });
      default:
        return null;
    }
  }
}

function customerDocumentHtml(input: {
  organizationName: string;
  customerName: string;
  type: string;
  number: string | null;
  status: string;
  currency: string;
  totalMinor: string;
  lines: readonly DocumentLine[];
}) {
  const rows = input.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.descriptionSnapshot)}</td><td>${escapeHtml(line.quantity.toString())}</td><td>${escapeHtml(line.lineTotalMinor.toString())}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px Arial;color:#10233f;padding:42px}h1{font-size:26px;margin:0 0 8px}p{color:#526681}table{width:100%;border-collapse:collapse;margin-top:28px}th,td{padding:10px;border-bottom:1px solid #dfe6ef;text-align:left}th:last-child,td:last-child{text-align:right}</style></head><body><p>${escapeHtml(input.organizationName)}</p><h1>${escapeHtml(input.type.replaceAll('_', ' '))} ${escapeHtml(input.number ?? '')}</h1><p>For ${escapeHtml(input.customerName)} · ${escapeHtml(input.status)}</p><table><thead><tr><th>Description</th><th>Quantity</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><h2>Total: ${escapeHtml(input.currency)} ${escapeHtml((Number(input.totalMinor) / 100).toFixed(2))}</h2></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ??
      character,
  );
}

/** The only contact columns the portal ever projects. Addresses read back in a stable order. */
const PROFILE_SELECT = {
  displayName: true,
  email: true,
  phone: true,
  addresses: { orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.ContactSelect;

function projectProfile(contact: {
  displayName: string;
  email: string | null;
  phone: string | null;
  addresses: ReadonlyArray<{
    id: string;
    kind: string;
    line1: string;
    line2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    countryCode: string;
    isDefault: boolean;
  }>;
}) {
  return {
    displayName: contact.displayName,
    email: contact.email,
    phone: contact.phone,
    addresses: contact.addresses.map((address) => ({
      id: address.id,
      kind: address.kind,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      countryCode: address.countryCode,
      isDefault: address.isDefault,
    })),
  };
}

/**
 * A contact holds at most one billing and one shipping default. Rejecting a second default for the
 * same kind here keeps the stored set unambiguous, rather than letting whichever row is read first
 * silently win.
 */
function assertOneDefaultPerKind(addresses: ReadonlyArray<{ kind: string; isDefault?: boolean }>) {
  for (const kind of ['BILLING', 'SHIPPING'] as const) {
    const defaults = addresses.filter(
      (address) => address.kind === kind && Boolean(address.isDefault),
    );
    if (defaults.length > 1) {
      throw new ConflictException(`Choose a single default ${kind.toLowerCase()} address.`);
    }
  }
}

function minorToDecimal(value: string) {
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value).padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function csvCell(value: string) {
  return CSV_QUOTED.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function summarizeInvitation(invitation: {
  id: string;
  email: string;
  status: PortalInvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}) {
  return {
    id: invitation.id,
    email: invitation.email,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
  };
}

/**
 * `exposedAt` is the moment the document became customer-visible. Every query that feeds this
 * already filters the column to non-null, but the model still types it as nullable; falling back to
 * the issue date keeps the sort total rather than asserting the filter from here.
 */
function documentSummary(
  type: string,
  item: DocumentSummarySource,
  number: string | null,
  exposedAt: Date | null,
) {
  return {
    id: item.id,
    type,
    number,
    status: item.status,
    issueDate: item.issueDate?.toISOString() ?? null,
    dueDate: item.dueDate?.toISOString() ?? null,
    currency: item.currency,
    totalMinor: String(item.totalMinor ?? item.amountMinor),
    exposedAt: (exposedAt ?? item.issueDate ?? new Date(0)).toISOString(),
  };
}

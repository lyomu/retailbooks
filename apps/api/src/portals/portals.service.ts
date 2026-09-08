import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';

import { AuthMailerService } from '../auth/auth-mailer.service.js';
import type { PublicUser } from '../auth/auth.service.js';
import { createOpaqueToken, hashToken } from '../auth/auth.crypto.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { StatementsService } from '../sales/statements.service.js';
import { DocumentRenderingService } from '../sales/document-rendering.service.js';
import type { PortalContext } from './portal-context.js';
import type { UpdatePortalProfileDto } from './portal.dto.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
    const db = this.prisma as any;
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
      users: users.map((grant: any) => ({
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
    const invitation = await this.prisma.$transaction(async (tx: any) => {
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
          notifiedAt: new Date(),
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
    const db = this.prisma as any;
    const previous = await db.portalInvitation.findFirst({
      where: { id: invitationId, organizationId: context.id, status: 'PENDING' },
      include: { contact: { select: { displayName: true } } },
    });
    if (!previous || previous.expiresAt <= new Date())
      throw new NotFoundException('Portal invitation not found.');
    return this.invite(context, actor, previous.contactId, previous.email);
  }

  async revokeInvitation(organizationId: string, invitationId: string) {
    const result = await (this.prisma as any).portalInvitation.updateMany({
      where: { id: invitationId, organizationId, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (result.count !== 1) throw new NotFoundException('Portal invitation not found.');
  }

  async revokeUser(organizationId: string, portalUserId: string) {
    const result = await (this.prisma as any).portalUser.updateMany({
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
    const grant = await this.prisma.$transaction(async (tx: any) => {
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
    const grants = await (this.prisma as any).portalUser.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        organization: { select: { legalName: true, tradingName: true } },
        contact: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return grants.map((grant: any) => ({
      id: grant.id,
      organizationName: grant.organization.tradingName ?? grant.organization.legalName,
      customerName: grant.contact.displayName,
    }));
  }

  async documents(portal: PortalContext, type?: string) {
    const db = this.prisma as any;
    const rows: Array<Record<string, unknown>> = [];
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
        ).map((item: any) => documentSummary('QUOTE', item, item.quoteNumber, item.sentAt)),
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
        ).map((item: any) =>
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
        ).map((item: any) => documentSummary('INVOICE', item, item.invoiceNumber, item.issueDate)),
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
        ).map((item: any) =>
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
        ).map((item: any) =>
          documentSummary('PAYMENT_RECEIVED', item, item.paymentNumber, item.receivedDate),
        ),
      );
    return rows.sort((a: any, b: any) => String(b.exposedAt).localeCompare(String(a.exposedAt)));
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
      issueDate: record.issueDate?.toISOString?.() ?? null,
      dueDate: record.dueDate?.toISOString?.() ?? null,
      currency: record.currency,
      totalMinor: String(record.totalMinor ?? record.amountMinor),
      lines: (record.lines ?? []).map((line: any) => ({
        description: line.descriptionSnapshot,
        quantity: String(line.quantity),
        unitPriceMinor: String(line.unitPriceMinor),
        discountMinor: String(line.discountMinor),
        totalMinor: String(line.lineTotalMinor),
      })),
    };
  }

  async decideQuote(portal: PortalContext, quoteId: string, decision: 'ACCEPTED' | 'DECLINED') {
    const changed = await this.prisma.$transaction(async (tx: any) => {
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
      });
      return tx.quote.findUnique({ where: { id: quoteId }, select: { id: true, status: true } });
    });
    return changed;
  }

  async updateProfile(portal: PortalContext, input: UpdatePortalProfileDto) {
    const db = this.prisma as any;
    const contact = await db.contact.update({
      where: { id: portal.contactId },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.addresses
          ? {
              addresses: {
                deleteMany: {},
                create: input.addresses.map((address) => ({
                  organizationId: portal.organizationId,
                  ...address,
                  isDefault: Boolean(address.isDefault),
                })),
              },
            }
          : {}),
      },
      include: { addresses: true },
    });
    return {
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      addresses: contact.addresses,
    };
  }

  async statement(portal: PortalContext, query: { from?: string; to?: string }) {
    // Statement derivation is shared with the internal endpoint, but the only identifiers supplied
    // come from PortalContext rather than request input.
    return this.statements.getStatement(portal.organizationId, portal.contactId, query);
  }

  async downloadDocument(portal: PortalContext, type: string, id: string) {
    const record = await this.portalDocumentRecord(portal, type, id);
    if (!record) throw new NotFoundException('Portal document not found.');
    const renderingType = type as
      'QUOTE' | 'SALES_ORDER' | 'INVOICE' | 'CREDIT_NOTE' | 'PAYMENT_RECEIVED';
    const snapshot = await this.documentRendering.render(
      portal.organizationId,
      renderingType,
      id,
      customerDocumentHtml({
        organizationName: portal.organizationName,
        customerName: portal.contactName,
        type,
        number: record.number,
        status: record.status,
        currency: record.currency,
        totalMinor: String(record.totalMinor ?? record.amountMinor),
        lines: record.lines ?? [],
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
    const db = this.prisma as any;
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
  ): Promise<any> {
    const db = this.prisma as any;
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
          .then((row: any) => row && { ...row, number: row.quoteNumber, dueDate: row.expiryDate });
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
          .then((row: any) => row && { ...row, number: row.orderNumber });
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
          .then((row: any) => row && { ...row, number: row.invoiceNumber });
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
          .then((row: any) => row && { ...row, number: row.creditNoteNumber });
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
          .then(
            (row: any) => row && { ...row, number: row.paymentNumber, issueDate: row.receivedDate },
          );
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
  lines: Array<{ descriptionSnapshot?: string; quantity?: unknown; lineTotalMinor?: unknown }>;
}) {
  const rows = input.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.descriptionSnapshot ?? '')}</td><td>${escapeHtml(String(line.quantity ?? ''))}</td><td>${escapeHtml(String(line.lineTotalMinor ?? ''))}</td></tr>`,
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

function summarizeInvitation(invitation: any) {
  return {
    id: invitation.id,
    email: invitation.email,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
  };
}

function documentSummary(type: string, item: any, number: string | null, exposedAt: Date) {
  return {
    id: item.id,
    type,
    number,
    status: item.status,
    issueDate: item.issueDate?.toISOString?.() ?? null,
    dueDate: item.dueDate?.toISOString?.() ?? null,
    currency: item.currency,
    totalMinor: String(item.totalMinor ?? item.amountMinor),
    exposedAt: exposedAt.toISOString(),
  };
}

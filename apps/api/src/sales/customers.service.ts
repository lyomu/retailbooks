import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type {
  ContactAddressDto,
  ContactTaxIdDto,
  CreateContactDto,
  UpdateContactDto,
} from './customers.dto.js';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, status?: 'ACTIVE' | 'INACTIVE') {
    const contacts = await this.prisma.contact.findMany({
      where: { organizationId, type: 'CUSTOMER', ...(status ? { status } : {}) },
      orderBy: [{ displayName: 'asc' }],
      include: { addresses: true, taxIds: true },
    });
    return contacts.map(summarize);
  }

  async detail(organizationId: string, contactId: string) {
    const contact = await this.findOrThrow(organizationId, contactId);
    return summarize(contact);
  }

  async create(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateContactDto,
    metadata: RequestMetadata,
  ) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: context.id },
      select: { baseCurrency: true },
    });
    const currency = input.currency ?? organization.baseCurrency;
    this.assertCurrencyAllowed(context, currency, organization.baseCurrency);

    const existing = await this.prisma.contact.findUnique({
      where: {
        organizationId_displayName: { organizationId: context.id, displayName: input.displayName },
      },
    });
    if (existing) throw new ConflictException('A customer with this name already exists.');

    const created = await this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.create({
        data: {
          organizationId: context.id,
          type: 'CUSTOMER',
          displayName: input.displayName,
          legalName: input.legalName ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          currency,
          paymentTermsDays: input.paymentTermsDays ?? null,
          receivableAccountId: input.receivableAccountId ?? null,
          tags: input.tags ?? [],
          addresses: { create: (input.addresses ?? []).map((a) => addressData(a, context.id)) },
          taxIds: { create: (input.taxIds ?? []).map((t) => taxIdData(t, context.id)) },
        },
        include: { addresses: true, taxIds: true },
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'customers.created',
        entityType: 'contact',
        entityId: contact.id,
        action: AuditAction.CREATE,
        after: { displayName: contact.displayName, currency: contact.currency },
        ipHash: metadata.ipHash,
      });

      return contact;
    });

    return summarize(created);
  }

  async update(
    context: OrganizationContext,
    user: PublicUser,
    contactId: string,
    input: UpdateContactDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, contactId);
    if (existing.status === 'INACTIVE') {
      throw new ConflictException('Deactivated customers cannot be edited.');
    }

    let nextCurrency = existing.currency;
    if (input.currency && input.currency !== existing.currency) {
      const organization = await this.prisma.organization.findUniqueOrThrow({
        where: { id: context.id },
        select: { baseCurrency: true },
      });
      this.assertCurrencyAllowed(context, input.currency, organization.baseCurrency);
      nextCurrency = input.currency;
    }

    if (input.displayName && input.displayName !== existing.displayName) {
      const clash = await this.prisma.contact.findUnique({
        where: {
          organizationId_displayName: {
            organizationId: context.id,
            displayName: input.displayName,
          },
        },
      });
      if (clash) throw new ConflictException('A customer with this name already exists.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.addresses) {
        await tx.contactAddress.deleteMany({ where: { contactId } });
      }
      if (input.taxIds) {
        await tx.contactTaxId.deleteMany({ where: { contactId } });
      }

      const contact = await tx.contact.update({
        where: { id: contactId },
        data: {
          displayName: input.displayName ?? existing.displayName,
          legalName: input.legalName ?? existing.legalName,
          email: input.email ?? existing.email,
          phone: input.phone ?? existing.phone,
          currency: nextCurrency,
          paymentTermsDays: input.paymentTermsDays ?? existing.paymentTermsDays,
          receivableAccountId: input.receivableAccountId ?? existing.receivableAccountId,
          tags: input.tags ?? existing.tags,
          ...(input.addresses
            ? { addresses: { create: input.addresses.map((a) => addressData(a, context.id)) } }
            : {}),
          ...(input.taxIds
            ? { taxIds: { create: input.taxIds.map((t) => taxIdData(t, context.id)) } }
            : {}),
        },
        include: { addresses: true, taxIds: true },
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'customers.updated',
        entityType: 'contact',
        entityId: contact.id,
        action: AuditAction.UPDATE,
        before: { displayName: existing.displayName, currency: existing.currency },
        after: { displayName: contact.displayName, currency: contact.currency },
        ipHash: metadata.ipHash,
      });

      return contact;
    });

    return summarize(updated);
  }

  async setStatus(
    context: OrganizationContext,
    user: PublicUser,
    contactId: string,
    status: 'ACTIVE' | 'INACTIVE',
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, contactId);
    if (existing.status === status) return summarize(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.update({
        where: { id: contactId },
        data: { status },
        include: { addresses: true, taxIds: true },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: status === 'ACTIVE' ? 'customers.reactivated' : 'customers.deactivated',
        entityType: 'contact',
        entityId: contactId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status },
        ipHash: metadata.ipHash,
      });
      return contact;
    });

    return summarize(updated);
  }

  private async findOrThrow(organizationId: string, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId, type: 'CUSTOMER' },
      include: { addresses: true, taxIds: true },
    });
    if (!contact) throw new NotFoundException('Customer not found.');
    return contact;
  }

  private assertCurrencyAllowed(
    context: OrganizationContext,
    currency: string,
    baseCurrency: string,
  ): void {
    if (currency === baseCurrency) return;
    if (!context.permissions.has('customers.currency_override')) {
      throw new ForbiddenException(
        "Only members with currency-override permission can set a customer's currency to something other than the organization's base currency.",
      );
    }
  }
}

function addressData(input: ContactAddressDto, organizationId: string) {
  return {
    organizationId,
    kind: input.kind,
    line1: input.line1,
    line2: input.line2 ?? null,
    city: input.city ?? null,
    region: input.region ?? null,
    postalCode: input.postalCode ?? null,
    countryCode: input.countryCode,
    isDefault: input.isDefault ?? false,
  };
}

function taxIdData(input: ContactTaxIdDto, organizationId: string) {
  return {
    organizationId,
    label: input.label,
    value: input.value,
    countryCode: input.countryCode ?? null,
  };
}

type ContactWithDetails = Prisma.ContactGetPayload<{
  include: { addresses: true; taxIds: true };
}>;

function summarize(contact: ContactWithDetails) {
  return {
    id: contact.id,
    type: contact.type,
    displayName: contact.displayName,
    legalName: contact.legalName,
    email: contact.email,
    phone: contact.phone,
    currency: contact.currency,
    paymentTermsDays: contact.paymentTermsDays,
    receivableAccountId: contact.receivableAccountId,
    status: contact.status,
    tags: contact.tags,
    addresses: contact.addresses,
    taxIds: contact.taxIds,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

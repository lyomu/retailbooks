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
  CreateVendorDto,
  UpdateVendorDto,
  VendorAddressDto,
  VendorTaxIdDto,
} from './vendors.dto.js';

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, status?: 'ACTIVE' | 'INACTIVE') {
    const vendors = await this.prisma.vendor.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: [{ displayName: 'asc' }],
      include: { addresses: true, taxIds: true },
    });
    return vendors.map(summarize);
  }

  async detail(organizationId: string, vendorId: string) {
    const vendor = await this.findOrThrow(organizationId, vendorId);
    return summarize(vendor);
  }

  /** Used by the UI before submitting create, to show "did you mean X?" ahead of the hard guard below. */
  async checkDuplicate(organizationId: string, displayName: string) {
    const matches = await this.findDuplicateMatches(organizationId, displayName, []);
    return matches.map((match) => ({
      id: match.id,
      displayName: match.displayName,
      matchedOn: match.matchedOn,
    }));
  }

  async create(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateVendorDto,
    metadata: RequestMetadata,
  ) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: context.id },
      select: { baseCurrency: true },
    });
    const currency = input.currency ?? organization.baseCurrency;
    this.assertCurrencyAllowed(context, currency, organization.baseCurrency);

    if (!input.confirmDuplicate) {
      const matches = await this.findDuplicateMatches(
        context.id,
        input.displayName,
        input.taxIds ?? [],
      );
      if (matches.length > 0) {
        throw new ConflictException(
          `A vendor with a similar name or tax ID already exists (${matches
            .map((match) => match.displayName)
            .join(', ')}). Resubmit with confirmDuplicate to create anyway.`,
        );
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.create({
        data: {
          organizationId: context.id,
          displayName: input.displayName,
          legalName: input.legalName ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          currency,
          paymentTermsDays: input.paymentTermsDays ?? null,
          payableAccountId: input.payableAccountId ?? null,
          tags: input.tags ?? [],
          addresses: { create: (input.addresses ?? []).map((a) => addressData(a, context.id)) },
          taxIds: { create: (input.taxIds ?? []).map((t) => taxIdData(t, context.id)) },
        },
        include: { addresses: true, taxIds: true },
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'vendors.created',
        entityType: 'vendor',
        entityId: vendor.id,
        action: AuditAction.CREATE,
        after: { displayName: vendor.displayName, currency: vendor.currency },
        ipHash: metadata.ipHash,
      });

      return vendor;
    });

    return summarize(created);
  }

  async update(
    context: OrganizationContext,
    user: PublicUser,
    vendorId: string,
    input: UpdateVendorDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, vendorId);
    if (existing.status === 'INACTIVE') {
      throw new ConflictException('Deactivated vendors cannot be edited.');
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

    if (
      input.displayName &&
      input.displayName.toLowerCase() !== existing.displayName.toLowerCase() &&
      !input.confirmDuplicate
    ) {
      const matches = await this.findDuplicateMatches(context.id, input.displayName, [], vendorId);
      if (matches.length > 0) {
        throw new ConflictException(
          `A vendor with a similar name already exists (${matches
            .map((match) => match.displayName)
            .join(', ')}). Resubmit with confirmDuplicate to rename anyway.`,
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.addresses) {
        await tx.vendorAddress.deleteMany({ where: { vendorId } });
      }
      if (input.taxIds) {
        await tx.vendorTaxId.deleteMany({ where: { vendorId } });
      }

      const vendor = await tx.vendor.update({
        where: { id: vendorId },
        data: {
          displayName: input.displayName ?? existing.displayName,
          legalName: input.legalName ?? existing.legalName,
          email: input.email ?? existing.email,
          phone: input.phone ?? existing.phone,
          currency: nextCurrency,
          paymentTermsDays: input.paymentTermsDays ?? existing.paymentTermsDays,
          payableAccountId: input.payableAccountId ?? existing.payableAccountId,
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
        eventKey: 'vendors.updated',
        entityType: 'vendor',
        entityId: vendor.id,
        action: AuditAction.UPDATE,
        before: { displayName: existing.displayName, currency: existing.currency },
        after: { displayName: vendor.displayName, currency: vendor.currency },
        ipHash: metadata.ipHash,
      });

      return vendor;
    });

    return summarize(updated);
  }

  async setStatus(
    context: OrganizationContext,
    user: PublicUser,
    vendorId: string,
    status: 'ACTIVE' | 'INACTIVE',
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, vendorId);
    if (existing.status === status) return summarize(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.update({
        where: { id: vendorId },
        data: { status },
        include: { addresses: true, taxIds: true },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: status === 'ACTIVE' ? 'vendors.reactivated' : 'vendors.deactivated',
        entityType: 'vendor',
        entityId: vendorId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status },
        ipHash: metadata.ipHash,
      });
      return vendor;
    });

    return summarize(updated);
  }

  private async findOrThrow(organizationId: string, vendorId: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, organizationId },
      include: { addresses: true, taxIds: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found.');
    return vendor;
  }

  /**
   * Duplicate-vendor warning, not rejection (unlike Sales' Contact.displayName unique constraint):
   * a case-insensitive display-name match, or a match on any submitted tax ID value against an
   * existing vendor's tax IDs, against active vendors. Callers surface this as a "did you mean X?"
   * prompt the user can bypass with `confirmDuplicate: true`, not a hard block.
   */
  private async findDuplicateMatches(
    organizationId: string,
    displayName: string,
    taxIds: VendorTaxIdDto[],
    excludeVendorId?: string,
  ): Promise<Array<{ id: string; displayName: string; matchedOn: 'displayName' | 'taxId' }>> {
    const taxIdValues = taxIds.map((t) => t.value.trim()).filter((value) => value.length > 0);

    const candidates = await this.prisma.vendor.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        ...(excludeVendorId ? { id: { not: excludeVendorId } } : {}),
        OR: [
          { displayName: { equals: displayName, mode: 'insensitive' } },
          ...(taxIdValues.length > 0 ? [{ taxIds: { some: { value: { in: taxIdValues } } } }] : []),
        ],
      },
      include: { taxIds: true },
    });

    return candidates.map((candidate) => ({
      id: candidate.id,
      displayName: candidate.displayName,
      matchedOn:
        candidate.displayName.toLowerCase() === displayName.toLowerCase()
          ? ('displayName' as const)
          : ('taxId' as const),
    }));
  }

  private assertCurrencyAllowed(
    context: OrganizationContext,
    currency: string,
    baseCurrency: string,
  ): void {
    if (currency === baseCurrency) return;
    if (!context.permissions.has('vendors.currency_override')) {
      throw new ForbiddenException(
        "Only members with currency-override permission can set a vendor's currency to something other than the organization's base currency.",
      );
    }
  }
}

function addressData(input: VendorAddressDto, organizationId: string) {
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

function taxIdData(input: VendorTaxIdDto, organizationId: string) {
  return {
    organizationId,
    label: input.label,
    value: input.value,
    countryCode: input.countryCode ?? null,
  };
}

type VendorWithDetails = Prisma.VendorGetPayload<{
  include: { addresses: true; taxIds: true };
}>;

function summarize(vendor: VendorWithDetails) {
  return {
    id: vendor.id,
    displayName: vendor.displayName,
    legalName: vendor.legalName,
    email: vendor.email,
    phone: vendor.phone,
    currency: vendor.currency,
    paymentTermsDays: vendor.paymentTermsDays,
    payableAccountId: vendor.payableAccountId,
    status: vendor.status,
    tags: vendor.tags,
    addresses: vendor.addresses,
    taxIds: vendor.taxIds,
    createdAt: vendor.createdAt.toISOString(),
    updatedAt: vendor.updatedAt.toISOString(),
  };
}

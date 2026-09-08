import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  InvitationStatus,
  MembershipStatus,
  OnboardingStep,
  OrganizationStatus,
  type Prisma,
} from '@prisma/client';

import { AuthMailerService } from '../auth/auth-mailer.service.js';
import { createOpaqueToken, hashToken } from '../auth/auth.crypto.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from './audit-event.js';
import { CountryPackStore, type ComplianceResolution } from './country-pack.store.js';
import { CurrencyService } from './currency.service.js';
import {
  findCountry,
  isSupportedChartTemplate,
  isSupportedCurrency,
  isSupportedLocale,
  isSupportedTimeZone,
  maxFiscalStartDay,
} from './jurisdiction-catalog.js';
import { LedgerService } from './ledger.service.js';
import { OrganizationAccessService } from './organization-access.service.js';
import type { MemberRole, OrganizationContext } from './organization-context.js';
import type {
  CreateOrganizationDto,
  OrganizationSection,
  UpdateOrganizationDto,
} from './organization.dto.js';
import { RolesService } from './roles.service.js';

/** Wizard order. A saved section advances the draft, never rewinds it. */
const ONBOARDING_ORDER: readonly OnboardingStep[] = [
  OnboardingStep.PROFILE,
  OnboardingStep.JURISDICTION,
  OnboardingStep.ACCOUNTING,
  OnboardingStep.TAX,
  OnboardingStep.NUMBERING,
  OnboardingStep.TEAM,
  OnboardingStep.REVIEW,
  OnboardingStep.COMPLETE,
];

const STEP_AFTER_SECTION: Record<OrganizationSection, OnboardingStep> = {
  PROFILE: OnboardingStep.JURISDICTION,
  JURISDICTION: OnboardingStep.ACCOUNTING,
  ACCOUNTING: OnboardingStep.TAX,
  TAX: OnboardingStep.NUMBERING,
  NUMBERING: OnboardingStep.TEAM,
  TEAM: OnboardingStep.REVIEW,
  REVIEW: OnboardingStep.REVIEW,
};

const organizationDetailSelect = {
  id: true,
  legalName: true,
  tradingName: true,
  slug: true,
  businessType: true,
  countryCode: true,
  baseCurrency: true,
  timeZone: true,
  locale: true,
  fiscalYearStartMonth: true,
  fiscalYearStartDay: true,
  status: true,
  onboardingStep: true,
  onboardingCompletedAt: true,
  createdAt: true,
  preferences: true,
} satisfies Prisma.OrganizationSelect;

type OrganizationDetailRow = Prisma.OrganizationGetPayload<{
  select: typeof organizationDetailSelect;
}>;

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly mailer: AuthMailerService,
    private readonly roles: RolesService,
    private readonly ledger: LedgerService,
    private readonly currencies: CurrencyService,
    private readonly countryPacks: CountryPackStore,
  ) {}

  async listForUser(userId: string, preferredOrganizationId: string | null) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId, status: MembershipStatus.ACTIVE },
      orderBy: { joinedAt: 'asc' },
      select: {
        joinedAt: true,
        role: {
          select: { key: true, name: true, permissions: { select: { permissionKey: true } } },
        },
        organization: {
          select: {
            id: true,
            legalName: true,
            tradingName: true,
            slug: true,
            status: true,
            onboardingStep: true,
            countryCode: true,
            baseCurrency: true,
          },
        },
      },
    });

    const organizations = memberships.map((membership) => ({
      ...membership.organization,
      role: membership.role.name,
      roleKey: membership.role.key,
      joinedAt: membership.joinedAt.toISOString(),
      permissions: membership.role.permissions.map((permission) => permission.permissionKey),
    }));

    return {
      organizations,
      activeOrganizationId: await this.access.resolveDefaultOrganizationId(
        userId,
        preferredOrganizationId,
      ),
    };
  }

  /**
   * Creates the draft organization, its owner membership, and its preference defaults in one
   * transaction. There is no window in which an organization exists without an owner.
   */
  async create(user: PublicUser, input: CreateOrganizationDto, metadata: RequestMetadata) {
    this.requireVerifiedEmail(user);

    const country = findCountry(input.countryCode);
    if (!country) {
      throw new BadRequestException('That country is not available yet.');
    }

    const draftCount = await this.prisma.organization.count({
      where: {
        status: OrganizationStatus.DRAFT,
        members: { some: { userId: user.id, role: { isOwnerRole: true } } },
      },
    });
    if (draftCount >= 3) {
      throw new ConflictException(
        'Finish or remove an unfinished organization setup before starting another.',
      );
    }

    const { organization, ownerRole } = await this.prisma.$transaction(
      async (
        tx,
      ): Promise<{
        organization: OrganizationDetailRow;
        ownerRole: { id: string; key: string; name: string; isOwnerRole: boolean };
      }> => {
        const created = await tx.organization.create({
          data: {
            legalName: input.legalName,
            ...(input.tradingName ? { tradingName: input.tradingName } : {}),
            slug: await uniqueSlug(tx, input.legalName),
            businessType: input.businessType,
            countryCode: country.code,
            baseCurrency: country.defaultCurrency,
            timeZone: country.defaultTimeZone,
            locale: country.defaultLocale,
            fiscalYearStartMonth: country.defaultFiscalStartMonth,
            fiscalYearStartDay: country.defaultFiscalStartDay,
            status: OrganizationStatus.DRAFT,
            onboardingStep: OnboardingStep.JURISDICTION,
            createdByUserId: user.id,
            preferences: {
              create: {
                countryPackCode: country.countryPackCode,
                countryPackVersion: country.countryPackVersion,
                journalPrefix: 'JRN',
              },
            },
          },
          select: organizationDetailSelect,
        });

        // Roles must exist before the owner membership can reference one -- roleId is a required
        // foreign key, so this cannot be deferred to first read the way the starter chart is.
        const seededRoles = await this.roles.seedSystemRoles(tx, created.id);
        const owner = seededRoles.get('OWNER');
        if (!owner) throw new Error('Owner role was not seeded.');

        await this.currencies.ensureOrganizationBaseCurrency(tx, created.id, created.baseCurrency);

        await tx.organizationMember.create({
          data: {
            organizationId: created.id,
            userId: user.id,
            roleId: owner.id,
            status: MembershipStatus.ACTIVE,
          },
        });

        await this.event(tx, user.id, created.id, 'organization.created', metadata, {
          countryCode: country.code,
        });

        return { organization: created, ownerRole: owner };
      },
    );

    return this.withCompliance(toOrganizationDetail(organization, ownerRole), organization);
  }

  async detail(context: OrganizationContext) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: context.id },
      select: organizationDetailSelect,
    });
    if (!organization) throw new NotFoundException('Organization not found.');
    return this.withCompliance(toOrganizationDetail(organization, context.role), organization);
  }

  async updateSection(
    context: OrganizationContext,
    user: PublicUser,
    input: UpdateOrganizationDto,
    metadata: RequestMetadata,
  ) {
    const organizationData: Prisma.OrganizationUpdateInput = {};
    const preferenceData: Prisma.OrganizationPreferenceUpdateInput = {};
    let requestedBaseCurrency: string | undefined;

    switch (input.section) {
      case 'PROFILE': {
        if (input.legalName !== undefined) organizationData.legalName = input.legalName;
        if (input.tradingName !== undefined) {
          organizationData.tradingName = input.tradingName === null ? null : input.tradingName;
        }
        if (input.businessType !== undefined) organizationData.businessType = input.businessType;
        break;
      }
      case 'JURISDICTION': {
        if (input.countryCode !== undefined) {
          const country = findCountry(input.countryCode);
          if (!country) throw new BadRequestException('That country is not available yet.');
          organizationData.countryCode = country.code;
          preferenceData.countryPackCode = country.countryPackCode;
          preferenceData.countryPackVersion = country.countryPackVersion;
        }
        if (input.baseCurrency !== undefined) {
          if (!isSupportedCurrency(input.baseCurrency)) {
            throw new BadRequestException('That base currency is not available yet.');
          }
          requestedBaseCurrency = input.baseCurrency;
        }
        if (input.timeZone !== undefined) {
          if (!isSupportedTimeZone(input.timeZone)) {
            throw new BadRequestException('That time zone is not available yet.');
          }
          organizationData.timeZone = input.timeZone;
        }
        if (input.locale !== undefined) {
          if (!isSupportedLocale(input.locale)) {
            throw new BadRequestException('That language is not available yet.');
          }
          organizationData.locale = input.locale;
        }
        if (input.fiscalYearStartMonth !== undefined || input.fiscalYearStartDay !== undefined) {
          const month = input.fiscalYearStartMonth ?? 1;
          const day = input.fiscalYearStartDay ?? 1;
          if (day > maxFiscalStartDay(month)) {
            throw new BadRequestException('That fiscal-year start date does not exist.');
          }
          organizationData.fiscalYearStartMonth = month;
          organizationData.fiscalYearStartDay = day;
        }
        break;
      }
      case 'ACCOUNTING': {
        if (input.accountingBasis !== undefined) {
          preferenceData.accountingBasis = input.accountingBasis;
        }
        if (input.chartTemplate !== undefined) {
          if (!isSupportedChartTemplate(input.chartTemplate)) {
            throw new BadRequestException('That starter chart of accounts is not available.');
          }
          preferenceData.chartTemplate = input.chartTemplate;
        }
        if (input.roundingMode !== undefined) {
          preferenceData.roundingMode = input.roundingMode;
        }
        if (input.roundingUnitMinor !== undefined) {
          preferenceData.roundingUnitMinor = input.roundingUnitMinor;
        }
        if (preferenceData.roundingMode === 'HALF_UP' || input.roundingMode === 'HALF_UP') {
          const unit = input.roundingUnitMinor ?? null;
          if (unit === null || unit < 2) {
            throw new BadRequestException(
              'A rounding unit of at least 2 minor units is required for HALF_UP rounding.',
            );
          }
        }
        preferenceData.booksStartDate = input.booksStartDate
          ? new Date(input.booksStartDate)
          : null;
        break;
      }
      case 'TAX': {
        // Compliance-sensitive setup: registering for tax or recording a tax identifier. Blocked
        // outright for packs with no compliance standing (Tier C or unknown) -- the badge says
        // "Unsupported" and the API must agree, never imply compliance where unreviewed.
        if (input.taxRegistered === true || (input.taxIdentifier ?? '') !== '') {
          const preference = await this.prisma.organizationPreference.findUnique({
            where: { organizationId: context.id },
            select: { countryPackCode: true, countryPackVersion: true },
          });
          const compliance = await this.countryPacks.resolveCompliance(
            preference?.countryPackCode,
            preference?.countryPackVersion,
          );
          if (compliance.status === 'UNSUPPORTED') {
            throw new BadRequestException(
              'This jurisdiction pack does not support compliance-sensitive tax setup.',
            );
          }
        }
        if (input.taxRegistered !== undefined) preferenceData.taxRegistered = input.taxRegistered;
        if (input.taxIdentifier !== undefined) {
          preferenceData.taxIdentifier = input.taxIdentifier || null;
        }
        if (input.defaultTaxTreatment !== undefined) {
          preferenceData.defaultTaxTreatment = input.defaultTaxTreatment;
        }
        if (input.defaultTaxRate !== undefined) {
          preferenceData.defaultTaxRate = input.defaultTaxRate;
        }
        break;
      }
      case 'NUMBERING': {
        if (input.journalPrefix !== undefined) preferenceData.journalPrefix = input.journalPrefix;
        if (input.numberPadding !== undefined) preferenceData.numberPadding = input.numberPadding;
        if (input.nextJournalNumber !== undefined) {
          preferenceData.nextJournalNumber = input.nextJournalNumber;
        }
        if (input.numberingReset !== undefined) {
          preferenceData.numberingReset = input.numberingReset;
        }
        break;
      }
      case 'TEAM':
      case 'REVIEW':
        break;
    }

    const organization = await this.prisma.$transaction(async (tx) => {
      const beforeOrganization = await tx.organization.findUniqueOrThrow({
        where: { id: context.id },
        select: organizationDetailSelect,
      });
      if (Object.keys(preferenceData).length > 0) {
        await tx.organizationPreference.update({
          where: { organizationId: context.id },
          data: preferenceData,
        });
      }

      if (context.status === OrganizationStatus.DRAFT) {
        const nextStep = laterStep(context.onboardingStep, STEP_AFTER_SECTION[input.section]);
        if (nextStep !== context.onboardingStep) organizationData.onboardingStep = nextStep;
      }

      if (requestedBaseCurrency !== undefined) {
        await this.currencies.setBaseCurrency(
          tx,
          context.id,
          requestedBaseCurrency,
          user,
          metadata,
        );
      }

      const updated =
        Object.keys(organizationData).length > 0
          ? await tx.organization.update({
              where: { id: context.id },
              data: organizationData,
              select: organizationDetailSelect,
            })
          : await tx.organization.findUniqueOrThrow({
              where: { id: context.id },
              select: organizationDetailSelect,
            });

      await this.event(tx, user.id, context.id, 'organization.section_updated', metadata, {
        section: input.section,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'organization.section_updated',
        entityType: 'organization',
        entityId: context.id,
        action: AuditAction.UPDATE,
        before: organizationAuditSnapshot(beforeOrganization, input.section),
        after: organizationAuditSnapshot(updated, input.section),
        metadata: { section: input.section },
        ipHash: metadata.ipHash,
      });

      return updated;
    });

    return this.withCompliance(toOrganizationDetail(organization, context.role), organization);
  }

  /**
   * Finalizes onboarding. The completeness check, the status change, and the foundation defaults
   * all happen inside one transaction, so an organization is never half-activated.
   */
  async finalize(context: OrganizationContext, user: PublicUser, metadata: RequestMetadata) {
    this.requireVerifiedEmail(user);

    const result = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: context.id },
        select: organizationDetailSelect,
      });
      if (!organization) throw new NotFoundException('Organization not found.');
      if (organization.status !== OrganizationStatus.DRAFT) {
        throw new ConflictException('This organization has already been set up.');
      }

      const missing = missingFinalizationFields(organization);
      if (missing.length > 0) {
        throw new BadRequestException({
          message: ['Complete the remaining setup steps before finishing.', ...missing],
        });
      }

      const owner = await tx.organizationMember.findFirst({
        where: {
          organizationId: context.id,
          role: { isOwnerRole: true },
          status: MembershipStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (!owner) {
        throw new ConflictException('This organization has no active owner.');
      }

      const country = findCountry(organization.countryCode);
      const activated = await tx.organization.update({
        where: { id: context.id, status: OrganizationStatus.DRAFT },
        data: {
          status: OrganizationStatus.ACTIVE,
          onboardingStep: OnboardingStep.COMPLETE,
          onboardingCompletedAt: new Date(),
          preferences: {
            update: {
              countryPackCode: country?.countryPackCode ?? 'GENERIC',
              countryPackVersion: country?.countryPackVersion ?? 'unversioned',
            },
          },
        },
        select: organizationDetailSelect,
      });

      await this.ledger.ensureStarterChart(
        context.id,
        activated.preferences?.chartTemplate ?? 'general-business',
        tx,
      );

      const pending = await tx.organizationInvitation.findMany({
        where: {
          organizationId: context.id,
          status: InvitationStatus.PENDING,
          notifiedAt: null,
        },
        select: { id: true, email: true },
      });
      if (pending.length > 0) {
        await tx.organizationInvitation.updateMany({
          where: { id: { in: pending.map(({ id }) => id) } },
          data: { notifiedAt: new Date() },
        });
      }

      await this.event(tx, user.id, context.id, 'organization.finalized', metadata, {
        invitationsQueued: pending.length,
      });

      return { organization: activated, pending };
    });

    // Invitation tokens are only known at issue time, so deferred mail carries a fresh token.
    for (const invitation of result.pending) {
      await this.reissueAndSendInvitation(invitation.id, result.organization.legalName, user);
    }

    return this.withCompliance(
      toOrganizationDetail(result.organization, context.role),
      result.organization,
    );
  }

  /**
   * Describes an invitation to whoever holds the token. Everything returned is already known to
   * the intended recipient, and `accountExists` lets the web application route to sign-in or
   * sign-up without a second, guessable lookup.
   */
  async previewInvitation(rawToken: string) {
    const invitation = await this.prisma.organizationInvitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        email: true,
        status: true,
        expiresAt: true,
        role: { select: { name: true } },
        organization: { select: { legalName: true, tradingName: true, status: true } },
      },
    });

    if (
      !invitation ||
      invitation.status !== InvitationStatus.PENDING ||
      invitation.expiresAt <= new Date()
    ) {
      throw new NotFoundException('This invitation link is invalid or has expired.');
    }

    const account = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true, emailVerifiedAt: true },
    });

    return {
      email: invitation.email,
      role: invitation.role.name,
      expiresAt: invitation.expiresAt.toISOString(),
      organizationName: invitation.organization.tradingName ?? invitation.organization.legalName,
      organizationReady: invitation.organization.status === OrganizationStatus.ACTIVE,
      accountExists: Boolean(account),
      accountVerified: Boolean(account?.emailVerifiedAt),
    };
  }

  async acceptInvitation(rawToken: string, user: PublicUser, metadata: RequestMetadata) {
    const invitation = await this.prisma.organizationInvitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        id: true,
        email: true,
        status: true,
        expiresAt: true,
        organizationId: true,
        roleId: true,
        role: { select: { name: true } },
        organization: { select: { legalName: true, status: true } },
      },
    });

    if (
      !invitation ||
      invitation.status !== InvitationStatus.PENDING ||
      invitation.expiresAt <= new Date()
    ) {
      throw new NotFoundException('This invitation link is invalid or has expired.');
    }
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException('This invitation was sent to a different email address.');
    }
    this.requireVerifiedEmail(user);
    if (invitation.organization.status === OrganizationStatus.SUSPENDED) {
      throw new ForbiddenException('This organization is suspended.');
    }
    if (invitation.organization.status !== OrganizationStatus.ACTIVE) {
      throw new ConflictException('This organization is still being set up. Try again shortly.');
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.organizationInvitation.updateMany({
        where: { id: invitation.id, status: InvitationStatus.PENDING },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt: new Date(),
          acceptedByUserId: user.id,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('This invitation has already been used.');
      }

      await tx.organizationMember.upsert({
        where: {
          organizationId_userId: { organizationId: invitation.organizationId, userId: user.id },
        },
        create: {
          organizationId: invitation.organizationId,
          userId: user.id,
          roleId: invitation.roleId,
          status: MembershipStatus.ACTIVE,
        },
        update: { status: MembershipStatus.ACTIVE },
      });

      await this.event(
        tx,
        user.id,
        invitation.organizationId,
        'organization.invitation_accepted',
        metadata,
        { role: invitation.role.name },
      );
    });

    return {
      organizationId: invitation.organizationId,
      organizationName: invitation.organization.legalName,
      role: invitation.role.name,
    };
  }

  private async reissueAndSendInvitation(
    invitationId: string,
    organizationName: string,
    inviter: PublicUser,
  ): Promise<void> {
    const rawToken = createOpaqueToken();
    const invitation = await this.prisma.organizationInvitation.update({
      where: { id: invitationId },
      data: { tokenHash: hashToken(rawToken), notifiedAt: new Date() },
      select: { email: true, expiresAt: true, role: { select: { name: true } } },
    });

    await this.mailer.sendOrganizationInvitation({
      email: invitation.email,
      organizationName,
      inviterName: inviter.displayName,
      roleName: invitation.role.name,
      token: rawToken,
      expiresAt: invitation.expiresAt,
    });
  }

  /**
   * Attaches the derived compliance resolution to an organization detail response. Derived at
   * read time from the organization's pinned pack version -- never stored -- so a tier change or
   * deprecation upstream is reflected the next time anyone looks, and an unreviewed pack can
   * never inherit a compliance claim it did not earn.
   */
  private async withCompliance<D extends object>(
    detail: D,
    organization: Pick<OrganizationDetailRow, 'preferences'>,
  ): Promise<D & { compliance: ComplianceResolution }> {
    const compliance = await this.countryPacks.resolveCompliance(
      organization.preferences?.countryPackCode,
      organization.preferences?.countryPackVersion,
    );
    return { ...detail, compliance };
  }

  private requireVerifiedEmail(user: PublicUser): void {
    if (!user.emailVerified) {
      throw new ForbiddenException('Verify your email address before setting up an organization.');
    }
  }

  private event(
    tx: Prisma.TransactionClient,
    userId: string,
    organizationId: string,
    eventKey: string,
    metadata: RequestMetadata,
    details: Prisma.InputJsonObject,
  ) {
    return tx.securityEvent.create({
      data: { userId, organizationId, eventKey, ipHash: metadata.ipHash, metadata: details },
    });
  }
}

function laterStep(current: OnboardingStep, candidate: OnboardingStep): OnboardingStep {
  const currentIndex = ONBOARDING_ORDER.indexOf(current);
  const candidateIndex = ONBOARDING_ORDER.indexOf(candidate);
  return candidateIndex > currentIndex ? candidate : current;
}

function missingFinalizationFields(organization: OrganizationDetailRow): string[] {
  const missing: string[] = [];
  if (organization.legalName.trim().length < 2)
    missing.push('A legal or business name is required.');
  if (!findCountry(organization.countryCode)) missing.push('Choose a supported country.');
  if (!isSupportedCurrency(organization.baseCurrency))
    missing.push('Choose a supported base currency.');
  if (!isSupportedTimeZone(organization.timeZone)) missing.push('Choose a supported time zone.');
  if (!isSupportedLocale(organization.locale)) missing.push('Choose a supported language.');
  if (organization.fiscalYearStartDay > maxFiscalStartDay(organization.fiscalYearStartMonth)) {
    missing.push('Choose a fiscal-year start date that exists.');
  }
  if (!organization.preferences) {
    missing.push('Accounting, tax, and numbering defaults are missing.');
  } else if (!isSupportedChartTemplate(organization.preferences.chartTemplate)) {
    missing.push('Choose a starter chart of accounts.');
  }
  return missing;
}

function toOrganizationDetail(organization: OrganizationDetailRow, role: MemberRole) {
  const preferences = organization.preferences;
  return {
    id: organization.id,
    legalName: organization.legalName,
    tradingName: organization.tradingName,
    slug: organization.slug,
    businessType: organization.businessType,
    countryCode: organization.countryCode,
    baseCurrency: organization.baseCurrency,
    timeZone: organization.timeZone,
    locale: organization.locale,
    fiscalYearStartMonth: organization.fiscalYearStartMonth,
    fiscalYearStartDay: organization.fiscalYearStartDay,
    status: organization.status,
    onboardingStep: organization.onboardingStep,
    onboardingCompletedAt: organization.onboardingCompletedAt?.toISOString() ?? null,
    createdAt: organization.createdAt.toISOString(),
    role: role.name,
    preferences: preferences
      ? {
          accountingBasis: preferences.accountingBasis,
          chartTemplate: preferences.chartTemplate,
          booksStartDate: preferences.booksStartDate?.toISOString().slice(0, 10) ?? null,
          taxRegistered: preferences.taxRegistered,
          taxIdentifier: preferences.taxIdentifier,
          defaultTaxTreatment: preferences.defaultTaxTreatment,
          defaultTaxRate: preferences.defaultTaxRate.toNumber(),
          journalPrefix: preferences.journalPrefix,
          numberPadding: preferences.numberPadding,
          nextJournalNumber: preferences.nextJournalNumber,
          numberingReset: preferences.numberingReset,
          countryPackCode: preferences.countryPackCode,
          countryPackVersion: preferences.countryPackVersion,
        }
      : null,
  };
}

function organizationAuditSnapshot(
  organization: OrganizationDetailRow,
  section: OrganizationSection,
): Prisma.InputJsonObject {
  switch (section) {
    case 'PROFILE':
      return {
        legalName: organization.legalName,
        tradingName: organization.tradingName,
        businessType: organization.businessType,
      };
    case 'JURISDICTION':
      return {
        countryCode: organization.countryCode,
        baseCurrency: organization.baseCurrency,
        timeZone: organization.timeZone,
        locale: organization.locale,
        fiscalYearStartMonth: organization.fiscalYearStartMonth,
        fiscalYearStartDay: organization.fiscalYearStartDay,
      };
    case 'ACCOUNTING':
      return {
        accountingBasis: organization.preferences?.accountingBasis ?? null,
        chartTemplate: organization.preferences?.chartTemplate ?? null,
        booksStartDate:
          organization.preferences?.booksStartDate?.toISOString().slice(0, 10) ?? null,
      };
    case 'TAX':
      return {
        taxRegistered: organization.preferences?.taxRegistered ?? null,
        taxIdentifier: organization.preferences?.taxIdentifier ?? null,
        defaultTaxTreatment: organization.preferences?.defaultTaxTreatment ?? null,
        defaultTaxRate: organization.preferences?.defaultTaxRate.toString() ?? null,
      };
    case 'NUMBERING':
      return {
        journalPrefix: organization.preferences?.journalPrefix ?? null,
        numberPadding: organization.preferences?.numberPadding ?? null,
        nextJournalNumber: organization.preferences?.nextJournalNumber ?? null,
        numberingReset: organization.preferences?.numberingReset ?? null,
      };
    case 'TEAM':
    case 'REVIEW':
      return { onboardingStep: organization.onboardingStep };
  }
}

function slugify(value: string): string {
  const base = value
    .normalize('NFKD')
    // Strip the combining marks that NFKD separated out, so accented names slug cleanly.
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base.length >= 2 ? base : 'organization';
}

async function uniqueSlug(tx: Prisma.TransactionClient, legalName: string): Promise<string> {
  const base = slugify(legalName);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${randomBytes(4).toString('hex')}`;
    const taken = await tx.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  throw new ConflictException('Could not allocate an organization address. Try again.');
}

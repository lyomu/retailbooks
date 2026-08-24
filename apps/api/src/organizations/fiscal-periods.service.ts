import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FiscalPeriodStatus, type Prisma } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import type { OrganizationContext } from './organization-context.js';
import type { GenerateFiscalYearDto, PeriodTransitionDto } from './organization.dto.js';
import {
  assertIsoDate,
  currentFiscalYearStart,
  generateFiscalYearDraft,
} from './fiscal-periods.calendar.js';

@Injectable()
export class FiscalPeriodsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    const fiscalYears = await this.prisma.fiscalYear.findMany({
      where: { organizationId },
      orderBy: { startsOn: 'desc' },
      include: { periods: { orderBy: { startsOn: 'asc' } } },
    });

    return fiscalYears.map((year) => ({
      id: year.id,
      label: year.label,
      startsOn: dateOnly(year.startsOn),
      endsOn: dateOnly(year.endsOn),
      status: year.status,
      periods: year.periods.map((period) => ({
        id: period.id,
        fiscalYearId: period.fiscalYearId,
        code: period.code,
        name: period.name,
        startsOn: dateOnly(period.startsOn),
        endsOn: dateOnly(period.endsOn),
        status: period.status,
        closedAt: period.closedAt?.toISOString() ?? null,
        lockedAt: period.lockedAt?.toISOString() ?? null,
        reopenedAt: period.reopenedAt?.toISOString() ?? null,
      })),
    }));
  }

  async generateFiscalYear(
    context: OrganizationContext,
    user: PublicUser,
    input: GenerateFiscalYearDto,
    metadata: RequestMetadata,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: context.id },
      select: {
        fiscalYearStartMonth: true,
        fiscalYearStartDay: true,
        timeZone: true,
      },
    });
    if (!organization) throw new NotFoundException('Organization not found.');

    const startsOn =
      input.startsOn ??
      currentFiscalYearStart(
        new Date(),
        organization.timeZone,
        organization.fiscalYearStartMonth,
        organization.fiscalYearStartDay,
      );
    try {
      assertIsoDate(startsOn);
    } catch {
      throw new BadRequestException('Fiscal year start must be a real YYYY-MM-DD date.');
    }

    const draft = generateFiscalYearDraft(startsOn);

    const created = await this.prisma
      .$transaction(async (tx) => {
        const fiscalYear = await tx.fiscalYear.create({
          data: {
            organizationId: context.id,
            label: draft.label,
            startsOn: draft.startsOn,
            endsOn: draft.endsOn,
            periods: {
              create: draft.periods.map((period) => ({
                organizationId: context.id,
                code: period.code,
                name: period.name,
                startsOn: period.startsOn,
                endsOn: period.endsOn,
              })),
            },
          },
          include: { periods: { orderBy: { startsOn: 'asc' } } },
        });

        await event(tx, user.id, context.id, 'periods.fiscal_year_created', metadata, {
          fiscalYearId: fiscalYear.id,
          label: fiscalYear.label,
          startsOn: draft.startsOn,
          endsOn: draft.endsOn,
        });

        return fiscalYear;
      })
      .catch((error: unknown) => {
        if (isUniqueConstraintError(error)) {
          throw new ConflictException('That fiscal year already exists for this organization.');
        }
        throw error;
      });

    return {
      id: created.id,
      label: created.label,
      startsOn: dateOnly(created.startsOn),
      endsOn: dateOnly(created.endsOn),
      status: created.status,
      periods: created.periods.map((period) => ({
        id: period.id,
        code: period.code,
        name: period.name,
        startsOn: dateOnly(period.startsOn),
        endsOn: dateOnly(period.endsOn),
        status: period.status,
      })),
    };
  }

  close(
    context: OrganizationContext,
    user: PublicUser,
    periodId: string,
    input: PeriodTransitionDto,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, periodId, FiscalPeriodStatus.CLOSED, input, metadata);
  }

  lock(
    context: OrganizationContext,
    user: PublicUser,
    periodId: string,
    input: PeriodTransitionDto,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, periodId, FiscalPeriodStatus.LOCKED, input, metadata);
  }

  reopen(
    context: OrganizationContext,
    user: PublicUser,
    periodId: string,
    input: PeriodTransitionDto,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, periodId, FiscalPeriodStatus.OPEN, input, metadata);
  }

  unlock(
    context: OrganizationContext,
    user: PublicUser,
    periodId: string,
    input: PeriodTransitionDto,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, periodId, FiscalPeriodStatus.CLOSED, input, metadata);
  }

  private async transition(
    context: OrganizationContext,
    user: PublicUser,
    periodId: string,
    nextStatus: FiscalPeriodStatus,
    input: PeriodTransitionDto,
    metadata: RequestMetadata,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const period = await tx.fiscalPeriod.findFirst({
        where: { id: periodId, organizationId: context.id },
        select: { id: true, code: true, status: true },
      });
      if (!period) throw new NotFoundException('Fiscal period not found.');
      assertTransition(period.status, nextStatus);

      const now = new Date();
      const changed = await tx.fiscalPeriod.update({
        where: { id: period.id },
        data: transitionData(nextStatus, now),
      });

      await event(tx, user.id, context.id, eventKey(nextStatus, period.status), metadata, {
        periodId: period.id,
        code: period.code,
        from: period.status,
        to: nextStatus,
        note: input.note ?? null,
      });

      return changed;
    });

    return {
      id: updated.id,
      code: updated.code,
      name: updated.name,
      startsOn: dateOnly(updated.startsOn),
      endsOn: dateOnly(updated.endsOn),
      status: updated.status,
      closedAt: updated.closedAt?.toISOString() ?? null,
      lockedAt: updated.lockedAt?.toISOString() ?? null,
      reopenedAt: updated.reopenedAt?.toISOString() ?? null,
    };
  }
}

function assertTransition(current: FiscalPeriodStatus, next: FiscalPeriodStatus): void {
  const allowed =
    (current === FiscalPeriodStatus.OPEN && next === FiscalPeriodStatus.CLOSED) ||
    (current === FiscalPeriodStatus.CLOSED && next === FiscalPeriodStatus.LOCKED) ||
    (current === FiscalPeriodStatus.CLOSED && next === FiscalPeriodStatus.OPEN) ||
    (current === FiscalPeriodStatus.LOCKED && next === FiscalPeriodStatus.CLOSED);

  if (!allowed) {
    throw new ConflictException(
      `Cannot move a ${current.toLowerCase()} period to ${next.toLowerCase()}.`,
    );
  }
}

function transitionData(status: FiscalPeriodStatus, at: Date): Prisma.FiscalPeriodUpdateInput {
  if (status === FiscalPeriodStatus.OPEN) {
    return { status, reopenedAt: at, closedAt: null, lockedAt: null };
  }
  if (status === FiscalPeriodStatus.CLOSED) {
    return { status, closedAt: at, lockedAt: null };
  }
  return { status, lockedAt: at };
}

function eventKey(next: FiscalPeriodStatus, previous: FiscalPeriodStatus): string {
  if (next === FiscalPeriodStatus.OPEN) return 'periods.period_reopened';
  if (next === FiscalPeriodStatus.LOCKED) return 'periods.period_locked';
  if (previous === FiscalPeriodStatus.LOCKED) return 'periods.period_unlocked';
  return 'periods.period_closed';
}

function event(
  tx: Prisma.TransactionClient,
  userId: string,
  organizationId: string,
  eventKeyValue: string,
  metadata: RequestMetadata,
  details: Prisma.InputJsonObject,
) {
  return tx.securityEvent.create({
    data: {
      userId,
      organizationId,
      eventKey: eventKeyValue,
      ipHash: metadata.ipHash,
      metadata: details,
    },
  });
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

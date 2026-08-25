import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma, RoundingMode } from '@prisma/client';
import { computeCashRoundingDelta } from '@retailbooks/accounting-core';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  PostingRule,
  PostingRuleSourceContext,
  RuleAccountRef,
} from '../posting-rules/posting-rule.js';
import { accountIdRef, systemKeyRef } from '../posting-rules/posting-rule.js';
import { PostingRulesService } from '../posting-rules/posting-rules.service.js';
import type { OrganizationContext } from './organization-context.js';

interface RoundingAdjustmentSource extends PostingRuleSourceContext {
  description?: string;
  lines: readonly {
    account: RuleAccountRef;
    description?: string;
    debitMinor: bigint;
    creditMinor: bigint;
  }[];
}

/**
 * Organization-configurable cash-rounding policy backed by the dedicated `rounding` system
 * account. With mode NONE (the default) nothing in the system rounds; with HALF_UP and a unit set,
 * document flows may post the payable-total difference through this helper as a balanced journal
 * via the declarative rule library.
 */
@Injectable()
export class RoundingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: PostingRulesService,
  ) {}

  /** The effective policy for an organization, resolved for callers that need to preview totals. */
  async policyFor(organizationId: string, client?: Prisma.TransactionClient) {
    const preferences = await (client ?? this.prisma).organizationPreference.findUnique({
      where: { organizationId },
      select: { roundingMode: true, roundingUnitMinor: true },
    });
    const mode: RoundingMode = preferences?.roundingMode ?? 'NONE';
    const unitMinor = BigInt(preferences?.roundingUnitMinor ?? 0);
    return { mode, unitMinor };
  }

  /** The delta a policy applies to `amountMinor`: positive = owe more, negative = owe less. */
  deltaFor(amountMinor: bigint, policy: { mode: RoundingMode; unitMinor: bigint }): bigint {
    if (policy.mode === 'NONE') return 0n;
    return computeCashRoundingDelta(amountMinor, policy.unitMinor);
  }

  /**
   * Posts a rounding adjustment: the difference moves between `adjustAccountId` (the account
   * carrying the computed amount -- e.g. receivable or cash) and the organization's `rounding`
   * account. A zero delta is a no-op returning null.
   */
  async postAdjustment(
    context: OrganizationContext,
    user: PublicUser,
    input: {
      journalDate: Date;
      currency: string;
      adjustAccountId: string;
      amountMinor: string | bigint;
      description?: string;
    },
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const amountMinor = BigInt(input.amountMinor);
    if (amountMinor === 0n) throw new BadRequestException('Rounding adjustment cannot be zero.');

    const policy = await this.policyFor(context.id);
    if (policy.mode === 'NONE') {
      throw new BadRequestException('This organization has no rounding policy configured.');
    }
    const delta = this.deltaFor(amountMinor, policy);

    const rule: PostingRule<RoundingAdjustmentSource> = {
      event: 'ROUNDING_ADJUSTMENT',
      sourceType: 'ROUNDING',
      version: 1,
      describe: (source) => source.description ?? 'Cash rounding adjustment',
      lines: (source) => source.lines,
    };

    const sourceId =
      input.description ??
      `ROUNDING:${input.journalDate.toISOString().slice(0, 10)}:${amountMinor.toString()}`;
    const posted = await this.rules.post(
      context,
      user,
      rule,
      {
        sourceId,
        journalDate: input.journalDate,
        currency: input.currency,
        description: input.description ?? undefined,
        lines:
          delta > 0n
            ? [
                {
                  account: accountIdRef(input.adjustAccountId),
                  debitMinor: delta,
                  creditMinor: 0n,
                },
                {
                  account: systemKeyRef('rounding'),
                  debitMinor: 0n,
                  creditMinor: delta,
                },
              ]
            : [
                {
                  account: accountIdRef(input.adjustAccountId),
                  debitMinor: 0n,
                  creditMinor: -delta,
                },
                {
                  account: systemKeyRef('rounding'),
                  debitMinor: -delta,
                  creditMinor: 0n,
                },
              ],
      },
      metadata,
      idempotencyKey ?? `${sourceId}:${delta.toString()}`,
    );
    return { journalId: posted.id, deltaMinor: delta.toString() };
  }
}

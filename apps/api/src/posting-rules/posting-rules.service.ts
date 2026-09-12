import { BadRequestException, Injectable } from '@nestjs/common';
import { LedgerAccountStatus, type Prisma } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { LedgerService } from '../organizations/ledger.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type { PostingRule, PostingRuleLineSpec, PostingRuleSourceContext } from './posting-rule.js';
import { postingRuleTag } from './posting-rule.js';

interface ResolvedLine {
  accountId: string;
  description?: string;
  debitMinor: bigint;
  creditMinor: bigint;
  foreignAmountMinor?: bigint;
  projectId?: string;
  tagId?: string;
}

export type RulePostedJournal = Awaited<ReturnType<LedgerService['postJournalFromLines']>>;

/**
 * Executes declarative posting rules. The executor owns every invariant the build spec's §6
 * "source event → validated posting rule → journal entry/lines" chain requires -- account
 * resolution by system key (never code/name), fail-closed validation of the produced lines before
 * any row exists, and source-to-ledger traceability via `journals.source_type`/`source_id` plus
 * the `event@vN` `posting_rule` tag -- while the actual posting itself stays inside
 * `LedgerService#postJournalFromLines`'s existing atomic/idempotent envelope.
 */
@Injectable()
export class PostingRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async post<TSource extends PostingRuleSourceContext>(
    context: OrganizationContext,
    user: PublicUser,
    rule: PostingRule<TSource>,
    source: TSource,
    metadata: RequestMetadata,
    idempotencyKey?: string,
    /** See `LedgerService#postJournalFromLines`'s `externalTx` for when to pass this. */
    externalTx?: Prisma.TransactionClient,
  ): Promise<RulePostedJournal> {
    const client = externalTx ?? this.prisma;
    const organization = await client.organization.findUniqueOrThrow({
      where: { id: context.id },
      select: { baseCurrency: true },
    });
    const isForeignCurrency = source.currency !== organization.baseCurrency;
    const resolved = await this.resolveLines(context.id, rule.lines(source), client);
    const postingLines = resolved.map((line) => ({
      ...line,
      foreignAmountMinor: isForeignCurrency ? line.foreignAmountMinor : undefined,
    }));
    this.validateLines(rule, postingLines);
    const tag = postingRuleTag(rule.event, rule.version);

    return this.ledger.postJournalFromLines(
      context,
      user,
      rule.event,
      {
        journalDate: source.journalDate,
        currency: source.currency,
        description: rule.describe(source),
        sourceType: rule.sourceType,
        sourceId: source.sourceId,
        postingRule: tag,
        lines: postingLines,
      },
      metadata,
      idempotencyKey,
      externalTx,
    );
  }

  /**
   * Resolves every line's account reference before anything is written. System keys resolve
   * through `accountBySystemKey` (lazily seeding the starter chart when needed); explicit ids must
   * name an active account in this organization. Any resolution failure throws before a journal
   * draft exists.
   */
  private async resolveLines(
    organizationId: string,
    specs: readonly PostingRuleLineSpec[],
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<ResolvedLine[]> {
    const resolved: ResolvedLine[] = [];
    for (const spec of specs) {
      if (spec.account.kind === 'SYSTEM_KEY') {
        const account = await this.ledger.accountBySystemKey(
          organizationId,
          spec.account.systemKey!,
          client,
        );
        resolved.push(this.asResolved(spec, account));
        continue;
      }
      const account = await client.ledgerAccount.findFirst({
        where: {
          id: spec.account.accountId!,
          organizationId,
          status: LedgerAccountStatus.ACTIVE,
        },
      });
      if (!account) {
        throw new BadRequestException('Posting rule references an unknown or inactive account.');
      }
      resolved.push(this.asResolved(spec, account));
    }
    return resolved;
  }

  private asResolved(
    spec: PostingRuleLineSpec,
    account: { id: string; status: string },
  ): ResolvedLine {
    if (account.status !== LedgerAccountStatus.ACTIVE) {
      throw new BadRequestException(
        spec.account.kind === 'SYSTEM_KEY'
          ? `Posting rule references system account "${spec.account.systemKey}", which is not available as an active account.`
          : 'Posting rule references an inactive account.',
      );
    }
    return {
      accountId: account.id,
      description: spec.description,
      debitMinor: spec.debitMinor ?? 0n,
      creditMinor: spec.creditMinor ?? 0n,
      foreignAmountMinor: spec.foreignAmountMinor,
      projectId: spec.projectId,
      tagId: spec.tagId,
    };
  }

  /**
   * Fail-closed structural validation: a rejected rule output never reaches the ledger, so a bug in
   * one rule cannot post an unbalanced or single-sided journal.
   */
  private validateLines(rule: PostingRule<never>, lines: readonly ResolvedLine[]): void {
    const label = `Posting rule ${postingRuleTag(rule.event, rule.version)}`;
    if (lines.length < 2) {
      throw new BadRequestException(`${label} produced fewer than two lines.`);
    }
    let debitTotal = 0n;
    let creditTotal = 0n;
    for (const [index, line] of lines.entries()) {
      if (line.debitMinor < 0n || line.creditMinor < 0n) {
        throw new BadRequestException(`${label} line ${index + 1} has a negative amount.`);
      }
      if (line.debitMinor > 0n && line.creditMinor > 0n) {
        throw new BadRequestException(`${label} line ${index + 1} has both debit and credit.`);
      }
      if (line.debitMinor === 0n && line.creditMinor === 0n) {
        throw new BadRequestException(`${label} line ${index + 1} is empty.`);
      }
      debitTotal += line.debitMinor;
      creditTotal += line.creditMinor;
    }
    if (debitTotal === 0n || creditTotal === 0n) {
      throw new BadRequestException(`${label} must move value on both sides.`);
    }
    if (debitTotal !== creditTotal) {
      throw new BadRequestException(
        `${label} produced an unbalanced journal (DR ${debitTotal} vs CR ${creditTotal}).`,
      );
    }
  }
}

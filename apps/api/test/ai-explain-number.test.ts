import { describe, expect, it, vi } from 'vitest';

import { AiGatewayException } from '../src/ai/ai-model.gateway';
import { AiOrchestrator } from '../src/ai/ai.orchestrator';

const organization = { id: 'organization-1' } as never;
const actor = { id: 'user-1' } as never;
const metadata = { ipHash: 'ai-explain-number-test', userAgent: 'RetailBooks AI test' };
const input = {
  reportKey: 'financial.profit-loss',
  rowId: 'account-1',
  from: '2026-01-01',
  to: '2026-12-31',
  resolvedQuestion: () => 'Explain this reported amount using only the supplied evidence.',
} as never;

function drillDownResult(amountMinor = '12500') {
  return {
    definition: { key: 'financial.profit-loss' },
    filters: { from: '2026-01-01', to: '2026-12-31' },
    baseCurrency: 'KES',
    row: {
      id: 'account-1',
      cells: { amountMinor, debitMinor: '0', creditMinor: amountMinor },
      source: {
        entityType: 'LedgerAccount',
        entityId: 'account-1',
        href: '/accounts/account-1/ledger',
      },
    },
    lines: [
      {
        id: 'line-1',
        cells: { debitMinor: '0', creditMinor: amountMinor },
        source: { entityType: 'Journal', entityId: 'journal-1', href: '/journals/journal-1' },
      },
    ],
    reconciled: true as const,
  };
}

describe('AiOrchestrator.explainNumber', () => {
  it('returns the deterministic drill-down without calling the model when AI is disabled', async () => {
    const reports = { drillDown: vi.fn().mockResolvedValue(drillDownResult()) };
    const gateway = {
      descriptor: () => ({ provider: 'DISABLED', model: 'disabled', modelVersion: null }),
      explain: vi.fn(),
    };
    const store = { createRun: vi.fn(), completeRun: vi.fn(), failRun: vi.fn() };
    const access = { requireMembership: vi.fn() };
    const ai = new AiOrchestrator(
      reports as never,
      gateway as never,
      store as never,
      access as never,
    );

    const result = await ai.explainNumber(organization, actor, input, metadata);

    expect(result.explanation).toEqual({ state: 'unavailable', reason: 'MODEL_DISABLED' });
    expect(result.drillDown.row.cells.amountMinor).toBe('12500');
    expect(gateway.explain).not.toHaveBeenCalled();
    expect(store.createRun).not.toHaveBeenCalled();
  });

  it('returns the deterministic drill-down with an unavailable explanation when the model call fails', async () => {
    const reports = { drillDown: vi.fn().mockResolvedValue(drillDownResult()) };
    const gateway = {
      descriptor: () => ({ provider: 'PRIVATE', model: 'deepseek-local', modelVersion: null }),
      explain: vi.fn().mockRejectedValue(new AiGatewayException('MODEL_NETWORK_FAILURE', true)),
    };
    const store = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      completeRun: vi.fn(),
      failRun: vi.fn().mockResolvedValue(undefined),
    };
    const access = { requireMembership: vi.fn() };
    const ai = new AiOrchestrator(
      reports as never,
      gateway as never,
      store as never,
      access as never,
    );

    const result = await ai.explainNumber(organization, actor, input, metadata);

    expect(result.explanation).toEqual({ state: 'unavailable', reason: 'MODEL_NETWORK_FAILURE' });
    expect(result.drillDown.row.cells.amountMinor).toBe('12500');
    expect(store.failRun).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'MODEL_NETWORK_FAILURE', runId: 'run-1' }),
    );
    expect(store.completeRun).not.toHaveBeenCalled();
    // Once for the initial deterministic result, once more to recompute a fresh number after
    // the AI failure — the number returned to the caller must never be older than a plain view.
    expect(reports.drillDown).toHaveBeenCalledTimes(2);
  });

  it('fails closed with no data when report permission is revoked while the model is running', async () => {
    const reports = { drillDown: vi.fn().mockResolvedValue(drillDownResult()) };
    const gateway = {
      descriptor: () => ({ provider: 'PRIVATE', model: 'deepseek-local', modelVersion: null }),
      explain: vi.fn().mockResolvedValue({
        summary: 'This account increased.',
        citationIds: ['line-1'],
        abstained: false,
        inputTokens: 5,
        outputTokens: 5,
      }),
    };
    const store = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      completeRun: vi.fn(),
      failRun: vi.fn().mockResolvedValue(undefined),
    };
    const access = {
      requireMembership: vi
        .fn()
        .mockResolvedValue({ id: 'organization-1', permissions: new Set() }),
    };
    const ai = new AiOrchestrator(
      reports as never,
      gateway as never,
      store as never,
      access as never,
    );

    await expect(ai.explainNumber(organization, actor, input, metadata)).rejects.toMatchObject({
      failureCode: 'MODEL_EVIDENCE_UNAUTHORIZED',
    });
    expect(store.completeRun).not.toHaveBeenCalled();
    expect(store.failRun).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'MODEL_EVIDENCE_UNAUTHORIZED', runId: 'run-1' }),
    );
  });

  it('fails closed to an unavailable state (not a thrown error) when the cited line changes before the answer returns', async () => {
    const reports = {
      drillDown: vi
        .fn()
        .mockResolvedValueOnce(drillDownResult('12500'))
        .mockResolvedValueOnce(drillDownResult('13000'))
        .mockResolvedValueOnce(drillDownResult('13000')),
    };
    const gateway = {
      descriptor: () => ({ provider: 'PRIVATE', model: 'deepseek-local', modelVersion: null }),
      explain: vi.fn().mockResolvedValue({
        summary: 'This account increased because of one posting.',
        citationIds: ['line-1'],
        abstained: false,
        inputTokens: 5,
        outputTokens: 5,
      }),
    };
    const store = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      completeRun: vi.fn(),
      failRun: vi.fn().mockResolvedValue(undefined),
    };
    const access = {
      requireMembership: vi
        .fn()
        .mockResolvedValue({ id: 'organization-1', permissions: new Set(['reports.view']) }),
    };
    const ai = new AiOrchestrator(
      reports as never,
      gateway as never,
      store as never,
      access as never,
    );

    const result = await ai.explainNumber(organization, actor, input, metadata);

    expect(result.explanation).toMatchObject({
      state: 'unavailable',
      reason: 'MODEL_EVIDENCE_STALE',
    });
    expect(result.drillDown.row.cells.amountMinor).toBe('13000');
    expect(store.completeRun).not.toHaveBeenCalled();
    expect(store.failRun).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'MODEL_EVIDENCE_STALE', runId: 'run-1' }),
    );
  });

  it('returns a ready explanation with resolved citations on success', async () => {
    const reports = { drillDown: vi.fn().mockResolvedValue(drillDownResult()) };
    const gateway = {
      descriptor: () => ({ provider: 'PRIVATE', model: 'deepseek-local', modelVersion: null }),
      explain: vi.fn().mockResolvedValue({
        summary: 'This account grew due to posted sales.',
        citationIds: ['line-1'],
        abstained: false,
        inputTokens: 6,
        outputTokens: 6,
      }),
    };
    const store = {
      createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      completeRun: vi.fn().mockResolvedValue({
        id: 'run-1',
        capability: 'NUMBER_EXPLANATION',
        provider: 'PRIVATE',
        model: 'deepseek-local',
        modelVersion: null,
        status: 'SUCCEEDED',
        createdAt: new Date(),
        completedAt: new Date(),
      }),
      failRun: vi.fn(),
    };
    const access = {
      requireMembership: vi
        .fn()
        .mockResolvedValue({ id: 'organization-1', permissions: new Set(['reports.view']) }),
    };
    const ai = new AiOrchestrator(
      reports as never,
      gateway as never,
      store as never,
      access as never,
    );

    const result = await ai.explainNumber(organization, actor, input, metadata);

    expect(result.explanation).toMatchObject({
      state: 'ready',
      abstained: false,
      citations: [{ sourceType: 'REPORT_ROW', sourceId: 'line-1', href: '/journals/journal-1' }],
    });
    expect(store.failRun).not.toHaveBeenCalled();
  });
});

import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { AiController } from '../src/ai/ai.controller';

describe('AiController', () => {
  it('consumes actor and organization limits before asking the orchestrator', async () => {
    const ai = { explainReport: vi.fn().mockResolvedValue({ run: { id: 'run-1' } }) };
    const rateLimit = { consume: vi.fn().mockResolvedValue(undefined) };
    const controller = new AiController(
      ai as never,
      { descriptor: vi.fn() } as never,
      { pepper: 'test-pepper' } as never,
      rateLimit as never,
      new ConfigService({
        AI_REQUEST_LIMIT_PER_HOUR: 30,
        AI_ORGANIZATION_REQUEST_LIMIT_PER_HOUR: 100,
      }),
      {} as never,
    );
    const request = {
      organization: { id: 'organization-1', permissions: new Set(['reports.view']) },
      auth: { user: { id: 'user-1' } },
      headers: {},
      get: () => undefined,
    } as never;

    await controller.ask(
      { reportKey: 'financial.general-ledger', question: 'Explain this report.' } as never,
      request,
    );

    expect(rateLimit.consume).toHaveBeenNthCalledWith(
      1,
      'ai:ask:actor:organization-1:user-1',
      30,
      3_600,
    );
    expect(rateLimit.consume).toHaveBeenNthCalledWith(
      2,
      'ai:ask:organization:organization-1',
      100,
      3_600,
    );
    expect(ai.explainReport).toHaveBeenCalledOnce();
  });
});

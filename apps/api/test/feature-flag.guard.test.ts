import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { FeatureFlagGuard } from '../src/platform/feature-flag.guard';

function contextWith(
  key: string | undefined,
  organizationId: string | undefined,
): {
  context: ExecutionContext;
  reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
} {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(key) };
  const request = organizationId ? { organization: { id: organizationId } } : {};
  const context = {
    getHandler: () => (() => undefined) as unknown,
    getClass: () => class {} as unknown,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('FeatureFlagGuard', () => {
  it('allows a handler with no @RequireFeatureFlag metadata without consulting entitlements', async () => {
    const { context, reflector } = contextWith(undefined, 'org-1');
    const entitlements = { isFlagEnabled: vi.fn() };
    const guard = new FeatureFlagGuard(entitlements as never, reflector as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(entitlements.isFlagEnabled).not.toHaveBeenCalled();
  });

  it('allows the request when the flag resolves enabled for the caller organization', async () => {
    const { context, reflector } = contextWith('phase13.report_drilldown', 'org-1');
    const entitlements = { isFlagEnabled: vi.fn().mockResolvedValue(true) };
    const guard = new FeatureFlagGuard(entitlements as never, reflector as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(entitlements.isFlagEnabled).toHaveBeenCalledWith('org-1', 'phase13.report_drilldown');
  });

  it('fails closed (403) when the flag resolves disabled -- the kill switch', async () => {
    const { context, reflector } = contextWith('phase13.report_drilldown', 'org-1');
    const entitlements = { isFlagEnabled: vi.fn().mockResolvedValue(false) };
    const guard = new FeatureFlagGuard(entitlements as never, reflector as never);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('fails closed when the request has no organization context yet', async () => {
    const { context, reflector } = contextWith('phase13.report_drilldown', undefined);
    const entitlements = { isFlagEnabled: vi.fn() };
    const guard = new FeatureFlagGuard(entitlements as never, reflector as never);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(entitlements.isFlagEnabled).not.toHaveBeenCalled();
  });
});

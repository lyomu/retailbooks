import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { DatabaseRoleGuard } from '../src/database/database-role.guard';

function guardFor(
  nodeEnv: string,
  role: { isSuperuser: boolean; bypassesRls: boolean; ownsAiTables: boolean } | undefined,
) {
  const prisma = { $queryRaw: vi.fn().mockResolvedValue(role ? [role] : []) };
  return {
    guard: new DatabaseRoleGuard(prisma as never, new ConfigService({ NODE_ENV: nodeEnv })),
    prisma,
  };
}

describe('DatabaseRoleGuard', () => {
  it('does not constrain local development database roles', async () => {
    const { guard, prisma } = guardFor('development', undefined);

    await expect(guard.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('accepts a restricted production runtime role', async () => {
    const { guard } = guardFor('production', {
      isSuperuser: false,
      bypassesRls: false,
      ownsAiTables: false,
    });

    await expect(guard.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it.each([
    { isSuperuser: true, bypassesRls: false, ownsAiTables: false },
    { isSuperuser: false, bypassesRls: true, ownsAiTables: false },
    { isSuperuser: false, bypassesRls: false, ownsAiTables: true },
    undefined,
  ])('rejects a bypass-capable or unknown production role', async (role) => {
    const { guard } = guardFor('production', role);

    await expect(guard.onApplicationBootstrap()).rejects.toThrow(
      /must be a non-superuser, non-BYPASSRLS, non-owner/,
    );
  });
});

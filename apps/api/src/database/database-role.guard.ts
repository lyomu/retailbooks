import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from './prisma.service.js';

interface RuntimeRoleRow {
  readonly isSuperuser: boolean;
  readonly bypassesRls: boolean;
  readonly ownsAiTables: boolean;
}

/**
 * AI evidence is protected with PostgreSQL RLS, which superusers and BYPASSRLS roles evade.
 * Production migrations must therefore run with a separate owner role; the API runs as a
 * restricted role after migrations have completed.
 */
@Injectable()
export class DatabaseRoleGuard implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') !== 'production') return;

    const [role] = await this.prisma.$queryRaw<RuntimeRoleRow[]>`
      SELECT
        roles.rolsuper AS "isSuperuser",
        roles.rolbypassrls AS "bypassesRls",
        EXISTS (
          SELECT 1
          FROM pg_class AS tables
          WHERE tables.relnamespace = 'public'::regnamespace
            AND tables.relname IN ('ai_runs', 'ai_evidence')
            AND tables.relowner = roles.oid
        ) AS "ownsAiTables"
      FROM pg_roles AS roles
      WHERE roles.rolname = current_user
    `;

    if (!role || role.isSuperuser || role.bypassesRls || role.ownsAiTables) {
      throw new Error(
        'The production database runtime role must be a non-superuser, non-BYPASSRLS, non-owner of AI RLS tables.',
      );
    }
  }
}

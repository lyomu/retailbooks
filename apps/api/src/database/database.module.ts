import { Global, Module } from '@nestjs/common';

import { DatabaseRoleGuard } from './database-role.guard.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, DatabaseRoleGuard],
  exports: [PrismaService],
})
export class DatabaseModule {}

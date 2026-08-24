import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { OrganizationsModule } from './organizations/organizations.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    OrganizationsModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}

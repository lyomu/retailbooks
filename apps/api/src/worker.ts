import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { WorkerAppModule } from './worker-app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerAppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('RetailBooks background worker started');
}

void bootstrap();

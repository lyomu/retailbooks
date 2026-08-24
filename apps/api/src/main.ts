import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { configureApp } from './app-setup.js';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  // bufferLogs holds startup output until the pino logger is attached, so nothing is emitted in the
  // default format first.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const port = Number(process.env.API_PORT ?? 3001);

  app.useLogger(app.get(Logger));
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');

  app.get(Logger).log(`RetailBooks API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();

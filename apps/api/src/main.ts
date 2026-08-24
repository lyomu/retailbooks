import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { configureApp } from './app-setup.js';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.API_PORT ?? 3001);

  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');

  Logger.log(`RetailBooks API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

void bootstrap();

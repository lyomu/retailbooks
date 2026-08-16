import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: true });
  const port = Number(process.env.API_PORT ?? 3001);

  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(port, '0.0.0.0');

  Logger.log(`RetailBooks API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();

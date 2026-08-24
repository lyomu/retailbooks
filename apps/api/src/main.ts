import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';

import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.API_PORT ?? 3001);
  const webOrigin = process.env.WEB_APP_URL ?? 'http://localhost:3000';

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: webOrigin, credentials: true });
  app.enableShutdownHooks();
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  app.use((request: Request, response: Response, next: NextFunction) => {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const origin = request.get('origin');
    if (unsafe && origin && origin !== webOrigin) {
      response.status(403).json({
        error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This request origin is not allowed.' },
      });
      return;
    }
    next();
  });
  await app.listen(port, '0.0.0.0');

  Logger.log(`RetailBooks API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

void bootstrap();

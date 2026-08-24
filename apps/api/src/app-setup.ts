import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { ApiExceptionFilter } from './common/api-exception.filter.js';

/**
 * Applies the API's global HTTP configuration.
 *
 * Both the production bootstrap and the integration-test harness call this, so a test exercises the
 * same prefix, validation, error shaping, and origin rules that production serves.
 */
export function configureApp(app: INestApplication): void {
  const webOrigin = process.env.WEB_APP_URL ?? 'http://localhost:3000';

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: webOrigin, credentials: true });
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
}

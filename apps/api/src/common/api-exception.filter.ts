import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { ERROR_REPORTER, type ErrorReporter } from './logging/error-reporter.js';
import { redactUrl } from './logging/redact.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(ApiExceptionFilter.name) private readonly logger: PinoLogger,
    @Inject(ERROR_REPORTER) private readonly errorReporter: ErrorReporter,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : null;
    const messages =
      typeof payload === 'object' && payload && 'message' in payload
        ? (payload as { message?: unknown }).message
        : exception instanceof Error
          ? exception.message
          : null;
    const validationMessages = Array.isArray(messages)
      ? messages.filter((message): message is string => typeof message === 'string')
      : undefined;
    const message =
      status >= 500
        ? 'Something went wrong. Please try again.'
        : validationMessages
          ? 'Some fields need your attention.'
          : typeof messages === 'string'
            ? messages
            : typeof payload === 'string'
              ? payload
              : 'Request could not be completed.';

    if (status >= 500) {
      const correlationId = correlationIdOf(request);
      const detail = {
        correlationId,
        method: request.method,
        url: redactUrl(request.originalUrl),
        statusCode: status,
      };

      this.logger.error(
        { ...detail, err: exception instanceof Error ? exception : new Error(String(exception)) },
        'Unhandled request failure',
      );
      this.errorReporter.captureException(exception, detail);
    }

    response.status(status).json({
      error: {
        code: errorCode(status, Boolean(validationMessages)),
        message,
        ...(validationMessages ? { fieldErrors: validationMessages } : {}),
      },
    });
  }
}

function correlationIdOf(request: Request): string | undefined {
  const id = (request as Request & { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

function errorCode(status: number, validation: boolean): string {
  if (validation) return 'VALIDATION_ERROR';
  const codes: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'AUTHENTICATION_REQUIRED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    429: 'RATE_LIMITED',
  };
  return codes[status] ?? 'INTERNAL_ERROR';
}

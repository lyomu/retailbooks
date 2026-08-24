import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

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
      this.logger.error(
        `${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
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

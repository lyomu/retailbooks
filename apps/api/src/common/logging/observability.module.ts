import { randomUUID } from 'node:crypto';

import { Global, Module } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';

import { ERROR_REPORTER, NoopErrorReporter } from './error-reporter.js';
import { redactUrl } from './redact.js';

const CORRELATION_HEADER = 'x-request-id';

/**
 * Structured logging, request correlation, and the error-reporting seam.
 *
 * OpenTelemetry is wired through `@opentelemetry/api` only, with no SDK. When no SDK is registered
 * the trace lookup is a no-op, so this stays cheap; registering one later activates trace/span ids
 * in every log line without touching this file.
 */
@Global()
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        // Health checks are polled constantly and say nothing useful once they pass.
        autoLogging: {
          ignore: (request: IncomingMessage) => (request.url ?? '').startsWith('/api/v1/health'),
        },
        genReqId: (request: IncomingMessage, response: ServerResponse) => {
          const existing = request.headers[CORRELATION_HEADER];
          const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
          response.setHeader(CORRELATION_HEADER, id);
          return id;
        },
        customProps: () => {
          const span = trace.getActiveSpan();
          if (!span) return {};
          const { traceId, spanId } = span.spanContext();
          return { traceId, spanId };
        },
        serializers: {
          req: (request: { id: unknown; method: string; url: string }) => ({
            id: request.id,
            method: request.method,
            url: redactUrl(request.url),
          }),
          res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            'req.body.password',
            'req.body.token',
          ],
          censor: '[redacted]',
        },
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } },
      },
    }),
  ],
  providers: [{ provide: ERROR_REPORTER, useClass: NoopErrorReporter }],
  exports: [ERROR_REPORTER],
})
export class ObservabilityModule {}

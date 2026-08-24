export interface ErrorReportContext {
  correlationId?: string;
  method?: string;
  url?: string;
  statusCode?: number;
}

/**
 * Seam for an external error-tracking service. The default implementation does nothing; swapping in
 * Sentry or similar is a provider change in `ObservabilityModule`, with no call-site edits.
 */
export interface ErrorReporter {
  captureException(error: unknown, context: ErrorReportContext): void;
}

export const ERROR_REPORTER = Symbol('ERROR_REPORTER');

export class NoopErrorReporter implements ErrorReporter {
  captureException(): void {
    // Intentionally empty: errors are already logged; this seam exists for a real reporter.
  }
}

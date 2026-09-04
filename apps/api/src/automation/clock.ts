/**
 * The one seam every due-time, retry, and replay calculation in automation goes through.
 * `SystemClock` is the only implementation wired in production; a test provides a fake bound to
 * this same `CLOCK` token so scheduler sweeps, misfire handling, and outbox backoff become
 * deterministic without faking global `Date`.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

interface ApiErrorPayload {
  error?: { code?: string; message?: string; fieldErrors?: string[] };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = 'REQUEST_FAILED',
    readonly fieldErrors: string[] = [],
  ) {
    super(message);
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new ApiError(
      payload.error?.message ?? 'The request could not be completed.',
      response.status,
      payload.error?.code,
      payload.error?.fieldErrors,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Multipart upload (attachments) -- deliberately skips the JSON `Content-Type` header apiRequest
 * always sets, so the browser can set its own multipart boundary. */
export async function apiUpload<T>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
): Promise<T> {
  const body = new FormData();
  body.append('file', file);
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    body,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new ApiError(
      payload.error?.message ?? 'The upload could not be completed.',
      response.status,
      payload.error?.code,
      payload.error?.fieldErrors,
    );
  }

  return response.json() as Promise<T>;
}

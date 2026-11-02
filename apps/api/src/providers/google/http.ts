import { ProviderError } from '../types.js';

interface GoogleErrorBody {
  error?: { code?: number; message?: string; status?: string };
}

const HINTS: Record<string, string> = {
  PERMISSION_DENIED:
    'Check that the API is enabled for your Google Cloud project and that the key is not restricted from calling it.',
  UNAUTHENTICATED: 'The Google Maps API key appears to be invalid.',
  RESOURCE_EXHAUSTED: 'Google Maps quota exceeded. Try again later or raise your quota.',
};

export async function googleRequest<T>(
  api: string,
  url: string,
  init: { method: 'GET' | 'POST'; apiKey: string; fieldMask?: string; body?: unknown; timeoutMs?: number },
): Promise<T> {
  const headers: Record<string, string> = { 'X-Goog-Api-Key': init.apiKey };
  if (init.fieldMask) headers['X-Goog-FieldMask'] = init.fieldMask;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ProviderError(`Could not reach the Google ${api}: ${reason}`, 502);
  }

  const text = await response.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON error page; handled below.
  }

  if (!response.ok) {
    const err = (json as GoogleErrorBody | undefined)?.error;
    const status = err?.status ?? `HTTP_${response.status}`;
    const hint = err?.status ? HINTS[err.status] : undefined;
    const message = `Google ${api} error (${status}): ${err?.message ?? text.slice(0, 200)}${hint ? ` ${hint}` : ''}`;
    const statusCode = response.status === 400 ? 400 : response.status === 429 ? 429 : 502;
    throw new ProviderError(message, statusCode, status);
  }
  return (json ?? {}) as T;
}

/** Google returns durations as strings like "3600s". */
export function parseDuration(value: string | undefined): number {
  if (!value) return 0;
  const n = Number.parseFloat(value.replace(/s$/, ''));
  return Number.isFinite(n) ? n : 0;
}

import { ZodError } from 'zod';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody } from '@journey/shared';
import { PlanningError } from '../planner/errors.js';
import { ProviderError } from '../providers/types.js';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what: string): HttpError => new HttpError(404, `${what} not found`, 'not_found');
export const badRequest = (message: string): HttpError => new HttpError(400, message, 'bad_request');

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  const send = (status: number, body: ApiErrorBody) => void reply.status(status).send(body);

  if (error instanceof ZodError) {
    const first = error.issues[0];
    const where = first?.path.length ? `${first.path.join('.')}: ` : '';
    send(400, { error: 'validation_error', message: `${where}${first?.message ?? 'Invalid request'}`, details: error.issues });
    return;
  }
  if (error instanceof HttpError) {
    send(error.statusCode, { error: error.code, message: error.message });
    return;
  }
  if (error instanceof PlanningError) {
    send(422, { error: 'planning_error', message: error.message });
    return;
  }
  if (error instanceof ProviderError) {
    request.log.warn({ err: error, providerCode: error.providerCode }, 'Upstream provider error');
    const status = error.statusCode === 422 || error.statusCode === 404 ? error.statusCode : error.statusCode === 429 ? 503 : 502;
    send(status, { error: 'upstream_error', message: error.message });
    return;
  }
  const statusCode = (error as FastifyError).statusCode;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    send(statusCode, { error: (error as FastifyError).code ?? 'bad_request', message: error.message });
    return;
  }
  request.log.error({ err: error }, 'Unhandled error');
  send(500, { error: 'internal_error', message: 'Something went wrong on our side. Please try again.' });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { autocompleteQuerySchema, type AppConfig as PublicConfig } from '@journey/shared';
import type { AppConfig } from '../config.js';
import { withTimeZone } from '../planner/context.js';
import type { DataProvider } from '../providers/types.js';

export function registerPlaceRoutes(app: FastifyInstance, provider: DataProvider): void {
  app.get('/api/places/autocomplete', async (request) => {
    const { q, lat, lng, session } = autocompleteQuerySchema.parse(request.query);
    const bias = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
    return provider.places.autocomplete(q, { ...(bias ? { bias } : {}), ...(session ? { sessionToken: session } : {}) });
  });

  app.get('/api/places/:placeId', async (request) => {
    const { placeId } = z.object({ placeId: z.string().min(1).max(300) }).parse(request.params);
    const { session } = z.object({ session: z.string().max(100).optional() }).parse(request.query);
    return withTimeZone(await provider.places.getPlace(placeId, session));
  });
}

export function registerSystemRoutes(
  app: FastifyInstance,
  config: AppConfig,
  provider: DataProvider,
  ping: () => Promise<void>,
): void {
  app.get('/api/health', { logLevel: 'warn' }, async (_request, reply) => {
    try {
      await ping();
      return { status: 'ok', dataSource: provider.source };
    } catch {
      return reply.status(503).send({ status: 'degraded', dataSource: provider.source });
    }
  });

  app.get('/api/config', async (): Promise<PublicConfig> => ({
    dataSource: provider.source,
    mapsBrowserKey: provider.source === 'google' ? (config.mapsBrowserKey ?? null) : null,
    mapId: config.mapId ?? null,
  }));
}

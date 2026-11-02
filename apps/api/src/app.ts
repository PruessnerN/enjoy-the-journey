import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { AppConfig } from './config.js';
import type { TripRepository } from './db/tripRepository.js';
import { errorHandler } from './http/errors.js';
import type { DataProvider } from './providers/types.js';
import { registerPlaceRoutes, registerSystemRoutes } from './routes/systemRoutes.js';
import { registerTripRoutes } from './routes/tripRoutes.js';
import { TripService } from './services/tripService.js';

export interface AppDependencies {
  config: AppConfig;
  repo: TripRepository;
  provider: DataProvider;
}

export async function buildApp({ config, repo, provider }: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({ error: 'not_found', message: `No route for ${request.method} ${request.url}` });
  });

  const trips = new TripService(repo, provider);
  registerSystemRoutes(app, config, provider, () => repo.ping());
  registerPlaceRoutes(app, provider);
  registerTripRoutes(app, trips, config.plansPerHourPerIp);

  return app;
}

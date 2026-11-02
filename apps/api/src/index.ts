import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MemoryTripRepository, PgTripRepository, type TripRepository } from './db/tripRepository.js';
import { createDataProvider } from './providers/index.js';

async function connectRepository(databaseUrl: string | undefined): Promise<TripRepository> {
  if (!databaseUrl) return new MemoryTripRepository();
  // Postgres may still be starting up when the container launches.
  for (let attempt = 1; ; attempt++) {
    try {
      return await PgTripRepository.connect(databaseUrl);
    } catch (error) {
      if (attempt >= 15) throw error;
      console.warn(`Database not ready (attempt ${attempt}): ${error instanceof Error ? error.message : error}`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const repo = await connectRepository(config.databaseUrl);
  const provider = createDataProvider({
    googleApiKey: config.googleApiKey,
    forceDemo: config.useDemoData,
    cacheTtlMinutes: config.cacheTtlMinutes,
    concurrency: config.upstreamConcurrency,
  });
  const app = await buildApp({ config, repo, provider });

  if (!config.databaseUrl) app.log.warn('DATABASE_URL not set: trips are kept in memory and lost on restart.');
  if (provider.source === 'demo') {
    app.log.warn('No GOOGLE_MAPS_API_KEY configured: using built-in demo data (synthetic places and routes).');
  } else if (!config.mapsBrowserKey) {
    app.log.warn('GOOGLE_MAPS_BROWSER_KEY not set: the web app will show a simplified map instead of Google Maps.');
  }

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await repo.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

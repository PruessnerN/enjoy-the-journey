import { z } from 'zod';

const optionalString = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().optional());

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: optionalString,
  GOOGLE_MAPS_API_KEY: optionalString,
  GOOGLE_MAPS_BROWSER_KEY: optionalString,
  GOOGLE_MAPS_MAP_ID: optionalString,
  DATA_SOURCE: z.enum(['auto', 'google', 'demo']).default('auto'),
  CACHE_TTL_MINUTES: z.coerce.number().min(0).default(360),
  UPSTREAM_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(6),
  PLANS_PER_HOUR_PER_IP: z.coerce.number().int().min(1).default(60),
  SEARCHES_PER_HOUR_PER_IP: z.coerce.number().int().min(1).default(300),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = {
  port: number;
  host: string;
  databaseUrl: string | undefined;
  googleApiKey: string | undefined;
  mapsBrowserKey: string | undefined;
  mapId: string | undefined;
  useDemoData: boolean;
  cacheTtlMinutes: number;
  upstreamConcurrency: number;
  plansPerHourPerIp: number;
  searchesPerHourPerIp: number;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const e = parsed.data;
  if (e.DATA_SOURCE === 'google' && !e.GOOGLE_MAPS_API_KEY) {
    throw new Error('DATA_SOURCE=google requires GOOGLE_MAPS_API_KEY to be set.');
  }
  return {
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    googleApiKey: e.GOOGLE_MAPS_API_KEY,
    mapsBrowserKey: e.GOOGLE_MAPS_BROWSER_KEY,
    mapId: e.GOOGLE_MAPS_MAP_ID,
    useDemoData: e.DATA_SOURCE === 'demo' || (e.DATA_SOURCE === 'auto' && !e.GOOGLE_MAPS_API_KEY),
    cacheTtlMinutes: e.CACHE_TTL_MINUTES,
    upstreamConcurrency: e.UPSTREAM_CONCURRENCY,
    plansPerHourPerIp: e.PLANS_PER_HOUR_PER_IP,
    searchesPerHourPerIp: e.SEARCHES_PER_HOUR_PER_IP,
    logLevel: e.LOG_LEVEL,
  };
}

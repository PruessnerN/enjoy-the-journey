import type { Trip, TripListItem } from '@journey/shared';
import pg from 'pg';

export interface TripRepository {
  list(): Promise<TripListItem[]>;
  get(id: string): Promise<Trip | null>;
  save(trip: Trip): Promise<void>;
  delete(id: string): Promise<boolean>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

function toListItem(trip: Trip): TripListItem {
  return {
    id: trip.id,
    name: trip.name,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    originName: trip.request.origin.name,
    destinationName: trip.request.destination.name,
    departureDate: trip.request.departureDate,
    days: trip.summary.days,
    totalDriveSeconds: trip.summary.totalDriveSeconds,
  };
}

/** Non-persistent storage for tests and quick local runs without Postgres. */
export class MemoryTripRepository implements TripRepository {
  private readonly trips = new Map<string, Trip>();

  async list(): Promise<TripListItem[]> {
    return [...this.trips.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(toListItem);
  }

  async get(id: string): Promise<Trip | null> {
    const trip = this.trips.get(id);
    return trip ? structuredClone(trip) : null;
  }

  async save(trip: Trip): Promise<void> {
    this.trips.set(trip.id, structuredClone(trip));
  }

  async delete(id: string): Promise<boolean> {
    return this.trips.delete(id);
  }

  async ping(): Promise<void> {}

  async close(): Promise<void> {}
}

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS trips (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS trips_updated_at_idx ON trips (updated_at DESC);
    `,
  },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Trips are stored as JSON documents; the itinerary is always read and written whole. */
export class PgTripRepository implements TripRepository {
  private constructor(private readonly pool: pg.Pool) {}

  static async connect(connectionString: string): Promise<PgTripRepository> {
    const pool = new pg.Pool({ connectionString, max: 10 });
    const repo = new PgTripRepository(pool);
    await repo.migrate();
    return repo;
  }

  private async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(727274)');
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const { rows } = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
      const applied = new Set(rows.map((r) => r.version));
      for (const m of MIGRATIONS) {
        if (applied.has(m.version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(m.sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
      client.release();
    }
  }

  async list(): Promise<TripListItem[]> {
    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      created_at: Date;
      updated_at: Date;
      origin_name: string | null;
      destination_name: string | null;
      departure_date: string | null;
      days: number | null;
      total_drive_seconds: number | null;
    }>(`
      SELECT id, name, created_at, updated_at,
             data #>> '{request,origin,name}' AS origin_name,
             data #>> '{request,destination,name}' AS destination_name,
             data #>> '{request,departureDate}' AS departure_date,
             (data #>> '{summary,days}')::int AS days,
             (data #>> '{summary,totalDriveSeconds}')::int AS total_drive_seconds
        FROM trips
       ORDER BY updated_at DESC
       LIMIT 200`);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      originName: r.origin_name ?? '',
      destinationName: r.destination_name ?? '',
      departureDate: r.departure_date ?? '',
      days: r.days ?? 0,
      totalDriveSeconds: r.total_drive_seconds ?? 0,
    }));
  }

  async get(id: string): Promise<Trip | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await this.pool.query<{ data: Trip }>('SELECT data FROM trips WHERE id = $1', [id]);
    return rows[0]?.data ?? null;
  }

  async save(trip: Trip): Promise<void> {
    await this.pool.query(
      `INSERT INTO trips (id, name, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [trip.id, trip.name, JSON.stringify(trip), trip.createdAt, trip.updatedAt],
    );
  }

  async delete(id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const result = await this.pool.query('DELETE FROM trips WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

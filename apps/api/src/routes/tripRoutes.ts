import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  dayUpdateSchema,
  regenerateDaySchema,
  replanSchema,
  swapSearchQuerySchema,
  tripPatchSchema,
  tripRequestSchema,
} from '@journey/shared';
import type { TripService } from '../services/tripService.js';

const idParams = z.object({ id: z.string().min(1).max(64) });
const dayParams = idParams.extend({ index: z.coerce.number().int().min(0).max(60) });
const stopParams = dayParams.extend({ stopId: z.string().min(1).max(64) });
const searchQuery = z.object({
  q: z.string().trim().min(2).max(120),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export interface TripRouteLimits {
  plansPerHour: number;
  searchesPerHour: number;
}

export function registerTripRoutes(app: FastifyInstance, trips: TripService, limits: TripRouteLimits): void {
  // Planning and place searches call paid upstream APIs, so they get stricter limits than reads.
  const planLimit = { config: { rateLimit: { max: limits.plansPerHour, timeWindow: '1 hour' } } };
  const searchLimit = { config: { rateLimit: { max: limits.searchesPerHour, timeWindow: '1 hour' } } };

  app.get('/api/trips', async () => trips.list());

  app.post('/api/trips', planLimit, async (request, reply) => {
    const body = tripRequestSchema.parse(request.body);
    const trip = await trips.create(body);
    return reply.status(201).send(trip);
  });

  app.get('/api/trips/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return trips.get(id);
  });

  app.patch('/api/trips/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const { name } = tripPatchSchema.parse(request.body);
    return trips.rename(id, name);
  });

  app.delete('/api/trips/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await trips.delete(id);
    return reply.status(204).send();
  });

  app.post('/api/trips/:id/replan', planLimit, async (request) => {
    const { id } = idParams.parse(request.params);
    const { request: tripRequest } = replanSchema.parse(request.body ?? {});
    return trips.replan(id, tripRequest);
  });

  app.put('/api/trips/:id/days/:index', async (request) => {
    const { id, index } = dayParams.parse(request.params);
    const update = dayUpdateSchema.parse(request.body);
    return trips.updateDay(id, index, update);
  });

  app.post('/api/trips/:id/days/:index/regenerate', planLimit, async (request) => {
    const { id, index } = dayParams.parse(request.params);
    const { freshIdeas } = regenerateDaySchema.parse(request.body ?? {});
    return trips.regenerateDay(id, index, freshIdeas ?? false);
  });

  app.get('/api/trips/:id/days/:index/stops/:stopId/alternatives', searchLimit, async (request) => {
    const { id, index, stopId } = stopParams.parse(request.params);
    return trips.swapSearch(id, index, stopId, swapSearchQuerySchema.parse(request.query));
  });

  app.get('/api/trips/:id/days/:index/search', searchLimit, async (request) => {
    const { id, index } = dayParams.parse(request.params);
    const { q, lat, lng } = searchQuery.parse(request.query);
    const near = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
    return trips.searchNearDay(id, index, q, near);
  });

  app.get('/api/trips/:id/calendar.ics', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { name, ics } = await trips.calendar(id);
    const filename = `${name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'trip'}.ics`;
    return reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(ics);
  });
}

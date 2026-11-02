import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DayUpdate, Trip, TripRequest } from '@journey/shared';
import { api } from './client';

export const keys = {
  config: ['config'] as const,
  trips: ['trips'] as const,
  trip: (id: string) => ['trip', id] as const,
};

export function useConfig() {
  return useQuery({ queryKey: keys.config, queryFn: api.config, staleTime: Infinity });
}

export function useTrips() {
  return useQuery({ queryKey: keys.trips, queryFn: api.listTrips });
}

export function useTrip(id: string) {
  return useQuery({ queryKey: keys.trip(id), queryFn: () => api.getTrip(id) });
}

/** Mutations return the updated trip; write it straight into the cache. */
function useTripMutation<V>(fn: (vars: V) => Promise<Trip>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (trip) => {
      client.setQueryData(keys.trip(trip.id), trip);
      void client.invalidateQueries({ queryKey: keys.trips });
    },
  });
}

export function useCreateTrip() {
  return useTripMutation((request: TripRequest) => api.createTrip(request));
}

export function useRenameTrip(id: string) {
  return useTripMutation((name: string) => api.renameTrip(id, name));
}

export function useReplanTrip(id: string) {
  return useTripMutation((request?: TripRequest) => api.replanTrip(id, request));
}

export function useUpdateDay(id: string) {
  return useTripMutation(({ index, update }: { index: number; update: DayUpdate }) => api.updateDay(id, index, update));
}

export function useRegenerateDay(id: string) {
  return useTripMutation(({ index, freshIdeas }: { index: number; freshIdeas: boolean }) =>
    api.regenerateDay(id, index, freshIdeas),
  );
}

export function useDeleteTrip() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTrip(id),
    onSuccess: (_void, id) => {
      client.removeQueries({ queryKey: keys.trip(id) });
      void client.invalidateQueries({ queryKey: keys.trips });
    },
  });
}

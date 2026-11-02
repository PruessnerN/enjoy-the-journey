import { LODGING_TYPES, type PlaceInfo, type SearchCategory, type Stop, type StopInput } from '@journey/shared';
import { toStopInput } from '../lib/dayEdits';

/**
 * The stop to put in place of `stop` when the user swaps in `place` found under `category`.
 * Meals stay the same meal; activities take on the new activity (and its usual duration if the
 * activity changed); lodging takes on the new kind of lodging, whose booking links the server rebuilds.
 */
export function swappedStop(stop: Stop, place: PlaceInfo, category: SearchCategory): StopInput {
  const next: StopInput = { ...toStopInput(stop), place, locked: true };
  delete next.links;

  if (category.group === 'activity') {
    const changed = category.id !== stop.activityId;
    next.kind = 'activity';
    next.activityId = category.id;
    next.activityLabel = category.label;
    next.emoji = category.emoji;
    if (category.outdoor !== undefined) next.outdoor = category.outdoor;
    if (changed && category.durationMinutes) next.durationMinutes = category.durationMinutes;
  } else if (category.group === 'lodging' && category.lodgingType) {
    const def = LODGING_TYPES[category.lodgingType];
    next.lodgingType = category.lodgingType;
    next.activityLabel = def.label;
    next.emoji = def.emoji;
  }
  return next;
}

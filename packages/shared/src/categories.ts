import { ACTIVITY_CATALOG, ACTIVITY_CATEGORIES, LODGING_TYPES, findActivityDefinition } from './catalog.js';
import type { ActivityRequest, LodgingType, MealType, StopKind } from './schemas.js';

/** A stop can only be swapped for something in its own group: meals stay meals, nights stay lodging. */
export type SwapGroup = 'activity' | 'meal' | 'lodging';

export interface SearchCategory {
  /** Activity id (e.g. `disc_golf`), `meal:<id>` or `lodging:<type>`. */
  id: string;
  group: SwapGroup;
  label: string;
  emoji: string;
  query: string;
  includedType?: string;
  /** Heading used to group categories in pickers. */
  section: string;
  /** Activities only. */
  durationMinutes?: number;
  outdoor?: boolean;
  /** Lodging only. */
  lodgingType?: LodgingType;
}

const meal = (id: string, label: string, emoji: string, query: string, includedType: string): SearchCategory => ({
  id: `meal:${id}`,
  group: 'meal',
  label,
  emoji,
  query,
  includedType,
  section: 'Places to eat',
});

/** Kinds of food to search for when swapping a meal stop. */
export const MEAL_CATEGORIES: SearchCategory[] = [
  meal('restaurant', 'Any restaurant', '🍽️', 'restaurant', 'restaurant'),
  meal('breakfast', 'Breakfast & brunch', '🍳', 'breakfast', 'breakfast_restaurant'),
  meal('cafe', 'Café & bakery', '🥐', 'cafe', 'cafe'),
  meal('quick', 'Quick bite', '🌯', 'fast food', 'fast_food_restaurant'),
  meal('diner', 'Diner', '🥞', 'diner', 'diner'),
  meal('burgers', 'Burgers', '🍔', 'burgers', 'hamburger_restaurant'),
  meal('pizza', 'Pizza', '🍕', 'pizza', 'pizza_restaurant'),
  meal('mexican', 'Mexican', '🌮', 'mexican restaurant', 'mexican_restaurant'),
  meal('bbq', 'BBQ', '🍖', 'bbq', 'barbecue_restaurant'),
  meal('steakhouse', 'Steakhouse', '🥩', 'steakhouse', 'steak_house'),
  meal('asian', 'Asian', '🍜', 'asian restaurant', 'asian_restaurant'),
  meal('sandwich', 'Sandwiches', '🥪', 'sandwich shop', 'sandwich_shop'),
  meal('seafood', 'Seafood', '🦐', 'seafood restaurant', 'seafood_restaurant'),
  meal('vegetarian', 'Vegetarian', '🥗', 'vegetarian restaurant', 'vegetarian_restaurant'),
];

export const LODGING_CATEGORIES: SearchCategory[] = (Object.keys(LODGING_TYPES) as LodgingType[]).map((type) => {
  const def = LODGING_TYPES[type];
  return {
    id: `lodging:${type}`,
    group: 'lodging',
    label: def.label,
    emoji: def.emoji,
    query: def.query,
    ...(def.includedType ? { includedType: def.includedType } : {}),
    section: 'Places to stay',
    lodgingType: type,
  };
});

export function swapGroupFor(kind: StopKind): SwapGroup | null {
  if (kind === 'meal') return 'meal';
  if (kind === 'lodging') return 'lodging';
  if (kind === 'activity' || kind === 'custom') return 'activity';
  return null;
}

function activityCategory(a: Pick<ActivityRequest, 'id' | 'label' | 'emoji' | 'query' | 'includedType' | 'durationMinutes' | 'outdoor'>, section: string): SearchCategory {
  const search = findActivityDefinition(a.id) ?? a;
  return {
    id: a.id,
    group: 'activity',
    label: a.label,
    emoji: a.emoji ?? '📍',
    query: search.query,
    ...(search.includedType ? { includedType: search.includedType } : {}),
    section,
    durationMinutes: a.durationMinutes,
    outdoor: a.outdoor,
  };
}

/** Categories offered for a group. Activities list the trip's own (including custom ones) first, then the rest of the catalog. */
export function searchCategoriesFor(group: SwapGroup, tripActivities: readonly ActivityRequest[]): SearchCategory[] {
  if (group === 'meal') return MEAL_CATEGORIES;
  if (group === 'lodging') return LODGING_CATEGORIES;
  const own = tripActivities.map((a) => activityCategory(a, 'Your activities'));
  const ownIds = new Set(own.map((c) => c.id));
  const rest = ACTIVITY_CATALOG.filter((def) => !ownIds.has(def.id)).map((def) =>
    activityCategory(
      { ...def, durationMinutes: def.durationMinutes },
      ACTIVITY_CATEGORIES.find((c) => c.id === def.category)?.label ?? 'More activities',
    ),
  );
  return [...own, ...rest];
}

export interface SwappableStop {
  kind: StopKind;
  activityId?: string;
  mealType?: MealType;
  lodgingType?: LodgingType;
}

/** The category a swap search starts on: whatever the stop currently is. */
export function defaultSearchCategory(stop: SwappableStop, tripActivities: readonly ActivityRequest[], tripLodging: LodgingType): string | null {
  const group = swapGroupFor(stop.kind);
  if (!group) return null;
  if (group === 'meal') return stop.mealType === 'breakfast' ? 'meal:breakfast' : 'meal:restaurant';
  if (group === 'lodging') return `lodging:${stop.lodgingType ?? tripLodging}`;
  const options = searchCategoriesFor('activity', tripActivities);
  if (stop.activityId && options.some((c) => c.id === stop.activityId)) return stop.activityId;
  return findActivityDefinition('top_attractions') ? 'top_attractions' : (options[0]?.id ?? null);
}

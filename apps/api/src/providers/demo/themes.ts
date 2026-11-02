import type { OpeningPeriod } from '@journey/shared';
import { pick } from '../../util/random.js';

type Rng = () => number;

export interface DemoTheme {
  match: RegExp;
  primaryType: string;
  typeLabel: string;
  name: (rng: Rng, town: string) => string;
  hours?: OpeningPeriod[];
  /** Max distance from the route, km. */
  maxOffsetKm: number;
  /** Probability that a sampled spot along the route has one of these places. */
  density: number;
}

const ADJ = ['Golden', 'Silver', 'Hidden', 'Lazy', 'Rusty', 'Blue', 'Wild', 'Lucky', 'Old', 'Sunny', 'Little', 'Big Sky', 'Red Rock', 'Quiet'];
const NATURE = ['Pine', 'Aspen', 'Cedar', 'Juniper', 'Sagebrush', 'Eagle', 'Elk', 'Bear', 'Coyote', 'River', 'Canyon', 'Willow', 'Falcon', 'Bison'];
const FEATURE = ['Ridge', 'Creek', 'Hollow', 'Butte', 'Bluff', 'Meadow', 'Lake', 'Gulch', 'Springs', 'Point', 'Valley', 'Mesa'];
const FOLKS = ['Rosie', 'Hank', 'Mabel', 'Earl', 'Dolly', 'Gus', 'June', 'Walt', 'Opal', 'Buck', 'Lou', 'Pearl'];
const KITCHEN = ['Diner', 'Grill', 'Kitchen', 'Cafe', 'Bistro', 'Smokehouse', 'Taqueria', 'Pizzeria', 'Steakhouse', 'Noodle House'];
const TOPICS = ['History', 'Natural History', 'Pioneer Life', 'Railroads', 'Mining', 'Art', 'Science', 'Aviation'];
const ODDITIES = ['Potato', 'Spud', 'Jackalope', 'Cowboy Boot', 'Dinosaur', 'Coffee Pot', 'Thermometer', 'Paul Bunyan', 'Fish', 'Ball of Twine'];

function daily(openHour: number, closeHour: number, closedDays: number[] = []): OpeningPeriod[] {
  const periods: OpeningPeriod[] = [];
  for (let day = 0; day < 7; day++) {
    if (closedDays.includes(day)) continue;
    const closeDay = closeHour >= 24 ? (day + 1) % 7 : day;
    periods.push({ open: { day, hour: openHour, minute: 0 }, close: { day: closeDay, hour: closeHour % 24, minute: 0 } });
  }
  return periods;
}

const n = (rng: Rng) => pick(rng, NATURE);
const f = (rng: Rng) => pick(rng, FEATURE);
const a = (rng: Rng) => pick(rng, ADJ);

export const DEMO_THEMES: DemoTheme[] = [
  { match: /disc golf/i, primaryType: 'park', typeLabel: 'Disc golf course', name: (r, t) => (r() < 0.5 ? `${n(r)} ${f(r)} Disc Golf Course` : `${t} Disc Golf Park`), maxOffsetKm: 9, density: 0.55 },
  { match: /hiking|trail/i, primaryType: 'hiking_area', typeLabel: 'Hiking area', name: (r) => `${n(r)} ${f(r)} Trailhead`, maxOffsetKm: 14, density: 0.7 },
  { match: /viewpoint|overlook/i, primaryType: 'scenic_spot', typeLabel: 'Scenic spot', name: (r) => `${n(r)} ${f(r)} Overlook`, maxOffsetKm: 5, density: 0.7 },
  { match: /state park|national park/i, primaryType: 'state_park', typeLabel: 'State park', name: (r) => `${n(r)} ${f(r)} State Park`, maxOffsetKm: 16, density: 0.45 },
  { match: /waterfall/i, primaryType: 'tourist_attraction', typeLabel: 'Waterfall', name: (r) => `${n(r)} Falls`, maxOffsetKm: 12, density: 0.35 },
  { match: /hot spring/i, primaryType: 'tourist_attraction', typeLabel: 'Hot spring', name: (r) => `${n(r)} Hot Springs`, maxOffsetKm: 15, density: 0.25, hours: daily(9, 21) },
  { match: /fishing/i, primaryType: 'fishing_pond', typeLabel: 'Fishing access', name: (r) => `${n(r)} ${f(r)} Fishing Access`, maxOffsetKm: 10, density: 0.5 },
  { match: /kayak|paddl|canoe/i, primaryType: 'tourist_attraction', typeLabel: 'Kayaking', name: (r) => (r() < 0.5 ? `${n(r)} River Kayak & Raft` : `${n(r)} Lake Paddle Launch`), maxOffsetKm: 10, density: 0.4, hours: daily(9, 19) },
  { match: /beach|lake|swim/i, primaryType: 'beach', typeLabel: 'Beach', name: (r) => `${n(r)} Lake Beach`, maxOffsetKm: 12, density: 0.4 },
  { match: /golf course/i, primaryType: 'golf_course', typeLabel: 'Golf course', name: (r) => `${n(r)} ${f(r)} Golf Club`, maxOffsetKm: 10, density: 0.4, hours: daily(6, 20) },
  { match: /coffee/i, primaryType: 'coffee_shop', typeLabel: 'Coffee shop', name: (r) => `${a(r)} Bean Coffee`, maxOffsetKm: 3, density: 0.75, hours: daily(6, 17) },
  { match: /brewery|taproom/i, primaryType: 'brewery', typeLabel: 'Brewery', name: (r) => `${n(r)} ${f(r)} Brewing Co.`, maxOffsetKm: 4, density: 0.5, hours: daily(12, 22) },
  { match: /winery|tasting/i, primaryType: 'winery', typeLabel: 'Winery', name: (r) => `${n(r)} ${f(r)} Cellars`, maxOffsetKm: 10, density: 0.35, hours: daily(11, 18, [1, 2]) },
  { match: /ice cream/i, primaryType: 'ice_cream_shop', typeLabel: 'Ice cream shop', name: (r) => `${a(r)} Scoop Creamery`, maxOffsetKm: 3, density: 0.6, hours: daily(11, 21) },
  { match: /museum/i, primaryType: 'museum', typeLabel: 'Museum', name: (r, t) => `${t} Museum of ${pick(r, TOPICS)}`, maxOffsetKm: 4, density: 0.5, hours: daily(10, 17, [1]) },
  { match: /historic site|landmark/i, primaryType: 'historical_landmark', typeLabel: 'Historical landmark', name: (r, t) => `${t} ${pick(r, ['Historic Depot', 'Pioneer Cemetery', 'Old Fort', 'Stagecoach Station', 'Oregon Trail Ruts'])}`, maxOffsetKm: 8, density: 0.55 },
  { match: /art gallery/i, primaryType: 'art_gallery', typeLabel: 'Art gallery', name: (r) => `${a(r)} ${n(r)} Gallery`, maxOffsetKm: 3, density: 0.4, hours: daily(10, 18, [1]) },
  { match: /antique/i, primaryType: 'store', typeLabel: 'Antique store', name: (r) => `${a(r)} Barn Antiques`, maxOffsetKm: 4, density: 0.5, hours: daily(10, 17, [0]) },
  { match: /playground/i, primaryType: 'playground', typeLabel: 'Playground', name: (r) => `${n(r)} Park Playground`, maxOffsetKm: 3, density: 0.7 },
  { match: /zoo|aquarium/i, primaryType: 'zoo', typeLabel: 'Zoo', name: (r, t) => `${t} Zoo`, maxOffsetKm: 8, density: 0.15, hours: daily(9, 17) },
  { match: /miniature golf|mini golf/i, primaryType: 'miniature_golf_course', typeLabel: 'Mini golf', name: (r) => `${a(r)} Putt Mini Golf`, maxOffsetKm: 4, density: 0.35, hours: daily(10, 21) },
  { match: /amusement|water park/i, primaryType: 'amusement_park', typeLabel: 'Amusement park', name: (r) => `${a(r)} ${n(r)} Fun Park`, maxOffsetKm: 8, density: 0.12, hours: daily(10, 20) },
  { match: /roadside/i, primaryType: 'tourist_attraction', typeLabel: 'Roadside attraction', name: (r) => `World's Largest ${pick(r, ODDITIES)}`, maxOffsetKm: 3, density: 0.4 },
  { match: /tourist attraction|attraction/i, primaryType: 'tourist_attraction', typeLabel: 'Tourist attraction', name: (r) => `${n(r)} ${f(r)}`, maxOffsetKm: 10, density: 0.6, hours: daily(9, 18) },
  { match: /cave/i, primaryType: 'tourist_attraction', typeLabel: 'Cave', name: (r) => `${n(r)} Caverns`, maxOffsetKm: 15, density: 0.15, hours: daily(9, 17) },
  { match: /downtown|shops/i, primaryType: 'shopping_mall', typeLabel: 'Historic downtown', name: (_r, t) => `Historic Downtown ${t}`, maxOffsetKm: 2, density: 0.5, hours: daily(10, 18) },
  { match: /breakfast/i, primaryType: 'breakfast_restaurant', typeLabel: 'Breakfast restaurant', name: (r) => `${pick(r, FOLKS)}'s Morning Cafe`, maxOffsetKm: 3, density: 0.8, hours: daily(6, 14) },
  { match: /restaurant|dinner|lunch|food/i, primaryType: 'restaurant', typeLabel: 'Restaurant', name: (r) => `${pick(r, FOLKS)}'s ${pick(r, KITCHEN)}`, maxOffsetKm: 3, density: 0.95, hours: daily(11, 22) },
  { match: /campground|rv park/i, primaryType: 'campground', typeLabel: 'Campground', name: (r) => `${n(r)} ${f(r)} Campground`, maxOffsetKm: 12, density: 0.75 },
  { match: /vacation rental|cabin|cottage/i, primaryType: 'cottage', typeLabel: 'Vacation rental', name: (r) => `${n(r)} ${f(r)} Cabins`, maxOffsetKm: 10, density: 0.35 },
  { match: /hotel|motel|lodging|resort/i, primaryType: 'hotel', typeLabel: 'Hotel', name: (r, t) => `${t} ${pick(r, ['Inn & Suites', 'Lodge', 'Grand Hotel', 'Motor Inn', 'Resort'])}`, maxOffsetKm: 3, density: 0.85 },
];

export const DEFAULT_THEME: DemoTheme = {
  match: /.*/,
  primaryType: 'point_of_interest',
  typeLabel: 'Point of interest',
  name: (r) => `${a(r)} ${n(r)} ${f(r)}`,
  maxOffsetKm: 8,
  density: 0.5,
};

export function themeFor(query: string, includedType?: string): DemoTheme {
  const text = `${query} ${includedType ?? ''}`;
  return DEMO_THEMES.find((t) => t.match.test(text)) ?? DEFAULT_THEME;
}

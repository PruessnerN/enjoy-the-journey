import { addDaysToIsoDate, type Link, type LodgingType, type PlaceInfo } from '@journey/shared';

const COUNTRIES = /^(USA|US|United States|United States of America|Canada|Mexico|México)$/i;

/** "123 Main St, Twin Falls, ID 83301, USA" → "Twin Falls, ID" */
export function townFromAddress(address: string | undefined): string | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && COUNTRIES.test(parts[parts.length - 1]!)) parts.pop();
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  const regionPart = parts[parts.length - 1]!;
  const cityPart = parts[parts.length - 2]!;
  const region = regionPart.split(/\s+/)[0] ?? regionPart;
  return /^\d/.test(cityPart) ? region : `${cityPart}, ${region}`;
}

export function lodgingLinks(type: LodgingType, place: PlaceInfo, town: string | null, checkIn: string, travelers: number, nights = 1): Link[] {
  const links: Link[] = [];
  const checkOut = addDaysToIsoDate(checkIn, Math.max(1, nights));
  if (place.websiteUri) links.push({ label: 'Website', url: place.websiteUri });
  if (place.googleMapsUri) links.push({ label: 'Google Maps', url: place.googleMapsUri });
  if (type === 'vacation_rental' && town) {
    const slug = town.replace(/,\s*/g, '--').replace(/\s+/g, '-');
    links.push({
      label: 'Airbnb',
      url: `https://www.airbnb.com/s/${encodeURIComponent(slug)}/homes?checkin=${checkIn}&checkout=${checkOut}&adults=${travelers}`,
    });
    links.push({
      label: 'VRBO',
      url: `https://www.vrbo.com/search?destination=${encodeURIComponent(town)}&startDate=${checkIn}&endDate=${checkOut}&adults=${travelers}`,
    });
  }
  if (type === 'campground' && town) {
    links.push({ label: 'Recreation.gov', url: `https://www.recreation.gov/search?q=${encodeURIComponent(town)}` });
  }
  return links;
}

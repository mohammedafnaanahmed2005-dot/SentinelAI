// ============================================================
//  SentinelAI – Centralised Map / Geo Provider Configuration
//  Single source of truth for the HERE Maps API key so it can be
//  rotated in one place (login location detection + threat map).
// ============================================================

/**
 * HERE Maps REST API key.
 * Used for:
 *   • Reverse geocoding (turn browser GPS coords into a real city/label)
 *   • Raster map tiles on the Threat Intelligence map
 * NOTE: If this key returns 401 it must be enabled for the
 * "Geocoding & Search" and "Raster Map" products in the HERE portal.
 */
export const HERE_API_KEY =
  '3d866a24afc0a19adf91407b686528afe7bae9e6f02f4e7bb9fd7080857d2bd5';

/** Reverse geocoding endpoint (coords -> address). */
export const HERE_REVGEO_URL =
  'https://revgeocode.search.hereapi.com/v1/revgeocode';

/** HERE raster tile template for Leaflet. Subdomains are 1,2,3,4. */
export const HERE_TILE_URL =
  'https://{s}.base.maps.ls.hereapi.com/maptile/2.1/maptile/newest/reduced.night/{z}/{x}/{y}/256/png8?apiKey=' +
  HERE_API_KEY;

export const HERE_TILE_SUBDOMAINS = ['1', '2', '3', '4'];

/** Fallback dark tiles (no key required) if HERE tiles fail. */
export const FALLBACK_TILE_URL =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
export const FALLBACK_TILE_SUBDOMAINS = ['a', 'b', 'c', 'd'];

// ============================================================
//  SentinelAI – Location Detection Service
//  Resolves the operator's real-world position for the adaptive
//  risk engine. Strategy (best available wins):
//    1. Browser GPS (navigator.geolocation)  -> HERE reverse geocode
//    2. IP based fallback (ipapi.co)          -> HERE reverse geocode
//    3. Static San Francisco baseline
//  Every network call is guarded so a rejected HERE key (401) or a
//  blocked GPS prompt never breaks the login flow.
// ============================================================

import { HERE_API_KEY, HERE_REVGEO_URL } from './config.ts';
import type { GeoLocation } from './types.ts';

/** HERE forward geocoding endpoint (text -> coords). */
const HERE_GEOCODE_URL = 'https://geocode.search.hereapi.com/v1/geocode';

export interface ResolvedLocation extends GeoLocation {
  /** Where the coordinates came from. */
  source: 'gps' | 'ip' | 'fallback';
  /** Reported accuracy in metres (GPS only). */
  accuracy?: number;
  /** True when HERE successfully enriched the coords with an address. */
  geocoded: boolean;
}

const DEFAULT_LOCATION: ResolvedLocation = {
  lat: 37.7749,
  lng: -122.4194,
  city: 'San Francisco, CA (baseline)',
  source: 'fallback',
  geocoded: false
};

/** Reverse geocode lat/lng into a human readable city label via HERE. */
export async function hereReverseGeocode(
  lat: number,
  lng: number
): Promise<string | null> {
  try {
    const url = `${HERE_REVGEO_URL}?at=${lat},${lng}&apiKey=${HERE_API_KEY}&lang=en-US&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null; // 401 / quota - fall back silently
    const data = await res.json();
    const item = data?.items?.[0];
    if (!item) return null;
    const addr = item.address ?? {};
    const city = addr.city || addr.county || addr.stateCode || addr.label || null;
    const state = addr.stateCode ? `, ${addr.stateCode}` : '';
    return city ? `${city}${state}` : null;
  } catch {
    return null;
  }
}

/** Ask the browser for a GPS fix. Resolves null if denied/unsupported. */
function getBrowserGPS(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: +pos.coords.latitude.toFixed(5),
        lng: +pos.coords.longitude.toFixed(5),
        accuracy: Math.round(pos.coords.accuracy ?? 0)
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
    );
  });
}

/** IP based fallback when GPS is unavailable (desktop / denied prompt). */
async function getIpLocation(): Promise<{ lat: number; lng: number; city?: string } | null> {
  try {
    const res = await fetch('https://ipapi.co/json/', { method: 'GET' });
    if (!res.ok) return null;
    const d = await res.json();
    if (typeof d?.latitude !== 'number') return null;
    return {
      lat: +d.latitude.toFixed(5),
      lng: +d.longitude.toFixed(5),
      city: d.city ? `${d.city}${d.region_code ? ', ' + d.region_code : ''}` : undefined
    };
  } catch {
    return null;
  }
}

/**
 * Forward geocode a free-text place (e.g. "Berlin" or "1600 Amphitheatre Pkwy")
 * into coordinates via HERE. Returns null when the key is rejected or the
 * place cannot be resolved, so callers can fall back gracefully.
 */
export async function hereGeocode(
  query: string
): Promise<{ lat: number; lng: number; label: string } | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const url = `${HERE_GEOCODE_URL}?q=${encodeURIComponent(q)}&apiKey=${HERE_API_KEY}&limit=1&lang=en-US`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const item = data?.items?.[0];
    const pos = item?.position;
    if (!pos) return null;
    return {
      lat: +Number(pos.lat).toFixed(5),
      lng: +Number(pos.lng).toFixed(5),
      label: item.address?.label ?? q
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the current operator location. Always resolves (never throws)
 * so callers can simply await it during login / registration.
 */
export async function resolveCurrentLocation(): Promise<ResolvedLocation> {
  // 1) Try real GPS first
  const gps = await getBrowserGPS();
  if (gps) {
    const geo = await hereReverseGeocode(gps.lat, gps.lng);
    const city = geo ?? 'GPS Client Location';
    return {
      lat: gps.lat, lng: gps.lng, city,
      source: 'gps', accuracy: gps.accuracy, geocoded: !!geo
    };
  }

  // 2) Fall back to IP geolocation
  const ip = await getIpLocation();
  if (ip) {
    const geo = await hereReverseGeocode(ip.lat, ip.lng);
    const city = geo ?? ip.city ?? 'IP Detected Location';
    return { lat: ip.lat, lng: ip.lng, city, source: 'ip', geocoded: true };
  }

  // 3) Static baseline
  return { ...DEFAULT_LOCATION };
}

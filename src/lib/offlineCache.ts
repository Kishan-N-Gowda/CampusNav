// Lightweight offline cache for CampusNav.
// - Locations & paths: persisted to localStorage and reused when offline / fetch fails.
// - Map image: persisted to the browser Cache Storage so it loads without network.

import { isDatabasePausedNow } from "./databasePause";

const LS_KEY = "campusnav.cache.v1";
const MAP_CACHE = "campusnav-map-v1";

export interface CachedCampusData<L, P> {
  locations: L[];
  paths: P[];
  cachedAt: number;
}

export function readCache<L, P>(bypassPause = false): CachedCampusData<L, P> | null {
  // If the database is currently paused and the caller is not an admin bypass,
  // do not return cached campus locations/paths to the public UI.
  if (!bypassPause && isDatabasePausedNow()) {
    return null;
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedCampusData<L, P>;
  } catch {
    return null;
  }
}

export function writeCache<L, P>(locations: L[], paths: P[], bypassPause = false) {
  // Never overwrite existing cached campus data with empty arrays while paused
  if (!bypassPause && isDatabasePausedNow() && locations.length === 0 && paths.length === 0) {
    return;
  }
  try {
    const payload: CachedCampusData<L, P> = {
      locations,
      paths,
      cachedAt: Date.now(),
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {
    // quota exceeded — ignore
  }
}

/** Pre-cache the map image so it survives offline reloads. */
export async function cacheMapAsset(url: string): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(MAP_CACHE);
    const existing = await cache.match(url);
    if (existing) return;
    const res = await fetch(url, { cache: "reload" });
    if (res.ok) await cache.put(url, res.clone());
  } catch {
    /* ignore */
  }
}

/** Return a usable URL for the map: cached blob URL when offline, otherwise the original. */
export async function resolveMapSrc(url: string): Promise<string> {
  if (typeof caches === "undefined") return url;
  if (navigator.onLine) {
    // Refresh in background, return original immediately.
    void cacheMapAsset(url);
    return url;
  }
  try {
    const cache = await caches.open(MAP_CACHE);
    const hit = await cache.match(url);
    if (hit) {
      const blob = await hit.blob();
      return URL.createObjectURL(blob);
    }
  } catch {
    /* ignore */
  }
  return url;
}

/**
 * Global Database / Content Pause (Maintenance Mode) configuration and utilities.
 *
 * When paused:
 * - Public queries for campus locations and paths return empty lists.
 * - No markers, paths, routes, or destination overlays are displayed on the public map.
 * - Public search returns no campus locations.
 * - Navigation instructions and route calculations are completely suppressed.
 * - All database records remain 100% preserved in Supabase.
 * - Admins can access the Admin Panel (/admin) to inspect, manage, and toggle pause/resume.
 */

export const DATABASE_PAUSED_SETTING_KEY = "database_paused";
export const DATABASE_PAUSED_STORAGE_KEY = "campusnav_database_paused";
export const DATABASE_PAUSE_EVENT = "campusnav_database_pause_changed";

export const DEFAULT_PAUSE_MESSAGE = "Campus Navigation is temporarily unavailable.";

export interface DatabasePauseState {
  paused: boolean;
  message: string;
  updatedAt?: string;
  updatedBy?: string;
}

/**
 * Robustly parses any raw value from database settings (JSON object, stringified JSON, boolean, or nested object)
 * into a normalized DatabasePauseState.
 */
export function parsePauseValue(raw: unknown): DatabasePauseState {
  let val = raw;

  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "false") return { paused: false, message: DEFAULT_PAUSE_MESSAGE };
    if (trimmed === "true") return { paused: true, message: DEFAULT_PAUSE_MESSAGE };
    try {
      val = JSON.parse(trimmed);
    } catch {
      // not valid json string
    }
  }

  if (typeof val === "boolean") {
    return { paused: val, message: DEFAULT_PAUSE_MESSAGE };
  }

  if (val && typeof val === "object") {
    const obj = val as Record<string, any>;

    let isPaused = false;
    if (typeof obj.paused === "boolean") {
      isPaused = obj.paused;
    } else if (typeof obj.paused === "string") {
      isPaused = obj.paused.toLowerCase() === "true";
    } else if (typeof obj.database_paused === "boolean") {
      isPaused = obj.database_paused;
    } else if (typeof obj.database_paused === "string") {
      isPaused = obj.database_paused.toLowerCase() === "true";
    } else if (typeof obj.isPaused === "boolean") {
      isPaused = obj.isPaused;
    } else if (typeof obj.isPaused === "string") {
      isPaused = obj.isPaused.toLowerCase() === "true";
    }

    const message =
      typeof obj.message === "string" && obj.message.trim()
        ? obj.message.trim()
        : DEFAULT_PAUSE_MESSAGE;

    return {
      paused: isPaused,
      message,
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : undefined,
      updatedBy: typeof obj.updatedBy === "string" ? obj.updatedBy : undefined,
    };
  }

  return { paused: false, message: DEFAULT_PAUSE_MESSAGE };
}

/**
 * Synchronously reads the current pause state from local storage.
 * Defaults to `paused: false` (live) unless an explicit pause state has been recorded.
 */
export function getDatabasePausedState(): DatabasePauseState {
  if (typeof window === "undefined") {
    return { paused: false, message: DEFAULT_PAUSE_MESSAGE };
  }
  try {
    const raw = localStorage.getItem(DATABASE_PAUSED_STORAGE_KEY);
    if (raw) {
      return parsePauseValue(raw);
    }
  } catch {
    // Fall back to live
  }
  return { paused: false, message: DEFAULT_PAUSE_MESSAGE };
}

/**
 * Returns true if the database content is currently in a paused state.
 */
export function isDatabasePausedNow(): boolean {
  return getDatabasePausedState().paused;
}

/**
 * Synchronously updates the local pause state and broadcasts an event to all components.
 */
export function setLocalDatabasePausedState(paused: boolean, message = DEFAULT_PAUSE_MESSAGE, user?: string) {
  if (typeof window === "undefined") return;
  try {
    const state: DatabasePauseState = {
      paused,
      message,
      updatedAt: new Date().toISOString(),
      updatedBy: user,
    };
    localStorage.setItem(DATABASE_PAUSED_STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(
      new CustomEvent(DATABASE_PAUSE_EVENT, {
        detail: state,
      })
    );
  } catch {
    // Ignore storage quota or disabled storage
  }
}


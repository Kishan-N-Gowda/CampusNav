/**
 * Path visibility logic
 * - Paths are hidden by default (unless in edit mode)
 * - Only the selected route is shown when user chooses a destination
 * - In admin/edit mode, all paths are visible with full controls
 */

import type { CampusPath, CampusLocation } from "@/data/locations";

export interface PathVisibilityState {
  showAllPaths: boolean; // Admin/edit mode
  selectedRouteIds: Set<string>; // Only show paths part of the selected route
}

/**
 * Determine if a path should be visible
 */
export function isPathVisible(
  path: CampusPath,
  state: PathVisibilityState,
  selectedRoute?: CampusLocation[]
): boolean {
  // In admin edit mode, show all paths
  if (state.showAllPaths) {
    return true;
  }

  // No route selected, don't show any paths
  if (!selectedRoute || selectedRoute.length < 2) {
    return false;
  }

  // Only show paths that are part of the selected route
  return state.selectedRouteIds.has(path.id);
}

/**
 * Get path IDs for a given route
 */
export function getRoutePathIds(
  route: CampusLocation[],
  allPaths: CampusPath[]
): Set<string> {
  const ids = new Set<string>();

  if (route.length < 2) return ids;

  for (let i = 0; i < route.length - 1; i++) {
    const from = route[i];
    const to = route[i + 1];

    const path = allPaths.find(
      (p) =>
        (p.source_id === from.id && p.destination_id === to.id) ||
        (p.source_id === to.id && p.destination_id === from.id)
    );

    if (path) {
      ids.add(path.id);
    }
  }

  return ids;
}

/**
 * Get visible paths for rendering
 */
export function getVisiblePaths(
  paths: CampusPath[],
  state: PathVisibilityState,
  selectedRoute?: CampusLocation[]
): CampusPath[] {
  return paths.filter((p) => isPathVisible(p, state, selectedRoute));
}

# Google-Maps-style live location tracking

Short answer: yes — and most of the foundation is already in the app. `useGeolocation` already watches the device GPS continuously (high accuracy, heading, speed), `src/lib/geo.ts` converts GPS coordinates into map coordinates using the saved GPS anchors, and the map already draws a blue puck with an accuracy halo and heading cone. What's missing is the "feels like Google Maps" layer: smooth motion, a camera that follows you, snapping to the drawn paths, and live re-routing.

## What this adds

1. **Smooth, continuous movement**
   GPS updates arrive every 1-3 seconds and jump around. Instead of teleporting the puck, animate it between fixes and filter out noisy readings (ignore fixes with poor accuracy, or that imply impossible speed). The puck glides and rotates instead of hopping.

2. **Follow mode (camera tracking)**
   The map keeps you centred as you move, with a zoomed-in view during navigation. Panning the map by hand temporarily breaks follow mode, and the existing recenter button snaps back to it. Optional heading-up mode where the map rotates so your direction of travel points up.

3. **Snap-to-path**
   Project your position onto the nearest drawn walkable path on the current floor, so the puck rides the corridor instead of drifting through walls — the same trick Google Maps uses for roads.

4. **Live route progress and re-routing**
   As you advance, the completed part of the route dims and the remaining part stays bold, the current step auto-advances, the ETA/distance pill updates from real movement, and voice guidance triggers on approach to each turn. If you stray too far from the route, it recalculates from your nearest node automatically.

5. **Arrival and floor awareness**
   Detect arrival at the destination (within a small radius) and show an arrival state. When you reach a staircase/lift connector, the map auto-switches to the next floor as it does today, now driven by live position rather than manual step advance.

## Accuracy expectations (important)

Phone GPS indoors is typically 10-30 m accurate and can be worse inside concrete buildings, so indoor floor-level tracking will never be as crisp as outdoor Google Maps. The mitigations above (accuracy filtering, snap-to-path, anchor-based correction) keep it usable, and the accuracy halo honestly communicates uncertainty. Outdoors on campus it will feel close to Google Maps.

## Technical notes

- `src/hooks/useGeolocation.ts`: add accuracy gating, a simple low-pass/Kalman-style filter on lat/lng, and smoothed heading with compass fallback (`deviceorientation`).
- New `src/hooks/useLiveTracking.ts`: owns the animated map-space position (requestAnimationFrame interpolation between filtered fixes), snap-to-path projection, off-route detection, and progress along the active route.
- `src/lib/geo.ts`: add point-to-polyline projection plus distance-along-polyline helpers.
- `src/components/CampusMap.tsx`: add follow-mode camera (pan/zoom driven by the live position), user-pan detection to suspend follow, optional map rotation, and dimming of the traversed route segment.
- `src/pages/Index.tsx`: wire the tracking hook into route state — auto step advance, auto floor switch, re-route trigger, arrival state, and live ETA for the existing pill.
- No database or backend changes; GPS anchors and calibration stay as they are.

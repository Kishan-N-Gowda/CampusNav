import React, { useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { Compass, MapPin, Navigation, ExternalLink, AlertTriangle, RefreshCw, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LiveGeo } from "@/hooks/useGeolocation";
import { GpsAnchor, formatCampusDistance } from "@/lib/geo";

interface OutdoorGoogleMapProps {
  userPosition: LiveGeo | null;
  anchors: GpsAnchor[];
  onSwitchToCampusMap: () => void;
  lang: "en" | "kn";
  onRoadDistanceChange?: (meters: number | null) => void;
}

export const OutdoorGoogleMap: React.FC<OutdoorGoogleMapProps> = ({
  userPosition,
  anchors,
  onSwitchToCampusMap,
  lang,
  onRoadDistanceChange,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const fallbackPolylineRef = useRef<google.maps.Polyline | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiNotice, setApiNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [roadDistanceMeters, setRoadDistanceMeters] = useState<number | null>(null);
  const [travelMode] = useState<google.maps.TravelMode>(
    typeof google !== "undefined" && google.maps ? google.maps.TravelMode.WALKING : ("WALKING" as unknown as google.maps.TravelMode)
  );

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  // Calculate campus center/main gate from existing anchors
  const campusTarget = React.useMemo(() => {
    if (anchors.length === 0) {
      // Default campus coords fallback if anchors loading
      return { lat: 13.0543, lng: 77.581623, name: "Campus Main Gate" };
    }
    const mainGate = anchors.find((a) => a.label.toLowerCase().includes("main"));
    if (mainGate) {
      return { lat: mainGate.lat, lng: mainGate.lng, name: mainGate.label };
    }
    // Centroid of all 10 anchors
    const avgLat = anchors.reduce((acc, a) => acc + a.lat, 0) / anchors.length;
    const avgLng = anchors.reduce((acc, a) => acc + a.lng, 0) / anchors.length;
    return { lat: avgLat, lng: avgLng, name: anchors[0].label || "Campus Entrance" };
  }, [anchors]);

  useEffect(() => {
    if (!apiKey) {
      setLoadError("Google Maps API key (VITE_GOOGLE_MAPS_API_KEY) is not configured.");
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setOptions({
      key: apiKey,
      v: "weekly",
    });

    Promise.all([
      importLibrary("maps"),
      importLibrary("routes"),
      importLibrary("marker"),
    ])
      .then(() => {
        if (!isMounted || !mapContainerRef.current) return;

        const defaultCenter = userPosition
          ? { lat: userPosition.lat, lng: userPosition.lng }
          : { lat: campusTarget.lat, lng: campusTarget.lng };

        const map = new google.maps.Map(mapContainerRef.current, {
          center: defaultCenter,
          zoom: 15,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          styles: [
            {
              featureType: "poi.school",
              elementType: "geometry",
              stylers: [{ color: "#e8f5e9" }],
            },
          ],
        });

        mapInstanceRef.current = map;

        // Add Campus Destination Marker
        new google.maps.Marker({
          position: { lat: campusTarget.lat, lng: campusTarget.lng },
          map,
          title: campusTarget.name,
          icon: {
            path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
            scale: 6,
            fillColor: "#ea4335",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "#ffffff",
          },
        });

        // Initialize Directions Renderer
        const directionsRenderer = new google.maps.DirectionsRenderer({
          map,
          suppressMarkers: false,
          polylineOptions: {
            strokeColor: "#2563eb",
            strokeOpacity: 0.8,
            strokeWeight: 5,
          },
        });
        directionsRendererRef.current = directionsRenderer;

        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load Google Maps JS API:", err);
        if (isMounted) {
          setLoadError("Failed to initialize Google Maps API. Please check your API key and network connection.");
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [apiKey, campusTarget, userPosition]);

  const renderDirectFallback = React.useCallback((
    map: google.maps.Map,
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number; name: string }
  ) => {
    if (directionsRendererRef.current) {
      directionsRendererRef.current.setMap(null);
    }

    if (!fallbackPolylineRef.current) {
      fallbackPolylineRef.current = new google.maps.Polyline({
        path: [origin, { lat: destination.lat, lng: destination.lng }],
        geodesic: true,
        strokeColor: "#2563eb",
        strokeOpacity: 0.85,
        strokeWeight: 4,
        map,
      });
    } else {
      fallbackPolylineRef.current.setPath([origin, { lat: destination.lat, lng: destination.lng }]);
      fallbackPolylineRef.current.setMap(map);
    }

    const bounds = new google.maps.LatLngBounds();
    bounds.extend(origin);
    bounds.extend({ lat: destination.lat, lng: destination.lng });
    map.fitBounds(bounds, { top: 70, bottom: 70, left: 50, right: 50 });

    const R = 6371000;
    const dLat = ((destination.lat - origin.lat) * Math.PI) / 180;
    const dLon = ((destination.lng - origin.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((origin.lat * Math.PI) / 180) *
        Math.cos((destination.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distM = R * c;

    setRoadDistanceMeters(distM);
    onRoadDistanceChange?.(distM);

    setApiNotice(
      lang === "kn"
        ? "ಕ್ಯಾಂಪಸ್ ಪ್ರವೇಶದ್ವಾರಕ್ಕೆ ನೇರ ಮಾರ್ಗ. ಪೂರ್ಣ ಟರ್ನ್-ಬೈ-ಟರ್ನ್ ನ್ಯಾವಿಗೇಷನ್‌ಗಾಗಿ ಗೂಗಲ್ ಮ್ಯಾಪ್ಸ್ ಆಪ್ ಬಳಸಿ."
        : "Direct route vector. Tap external app for turn-by-turn routing."
    );
  }, [lang, onRoadDistanceChange]);

  // Update user position marker and compute route to campus
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !userPosition || typeof google === "undefined" || !google.maps) return;

    const userLatLng = { lat: userPosition.lat, lng: userPosition.lng };

    // Update or create user marker
    if (!userMarkerRef.current) {
      userMarkerRef.current = new google.maps.Marker({
        position: userLatLng,
        map,
        title: "Your Location",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#3b82f6",
          fillOpacity: 1,
          strokeWeight: 3,
          strokeColor: "#ffffff",
        },
      });
    } else {
      userMarkerRef.current.setPosition(userLatLng);
    }

    try {
      const directionsService = new google.maps.DirectionsService();
      directionsService.route(
        {
          origin: userLatLng,
          destination: { lat: campusTarget.lat, lng: campusTarget.lng },
          travelMode: travelMode,
        },
        (result, status) => {
          if (status === google.maps.DirectionsStatus.OK && result) {
            setApiNotice(null);
            if (fallbackPolylineRef.current) {
              fallbackPolylineRef.current.setMap(null);
            }
            if (directionsRendererRef.current) {
              directionsRendererRef.current.setDirections(result);
            }
            const leg = result.routes[0]?.legs[0];
            if (leg && leg.distance && typeof leg.distance.value === "number") {
              const meters = leg.distance.value;
              setRoadDistanceMeters(meters);
              onRoadDistanceChange?.(meters);
            }
          } else {
            console.warn("[OutdoorGoogleMap] Directions service returned status:", status);
            renderDirectFallback(map, userLatLng, campusTarget);
          }
        }
      );
    } catch (err) {
      console.warn("[OutdoorGoogleMap] Directions exception:", err);
      renderDirectFallback(map, userLatLng, campusTarget);
    }
  }, [userPosition, campusTarget, travelMode, lang, renderDirectFallback, onRoadDistanceChange]);

  const openInGoogleMapsApp = () => {
    if (!userPosition) {
      window.open(
        `https://www.google.com/maps/search/?api=1&query=${campusTarget.lat},${campusTarget.lng}`,
        "_blank"
      );
      return;
    }
    window.open(
      `https://www.google.com/maps/dir/?api=1&origin=${userPosition.lat},${userPosition.lng}&destination=${campusTarget.lat},${campusTarget.lng}&travelmode=walking`,
      "_blank"
    );
  };

  if (loadError) {
    return (
      <div className="relative flex flex-col items-center justify-center rounded-3xl border border-amber-200 bg-amber-50/70 p-6 text-center dark:border-amber-900/40 dark:bg-amber-950/20">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h3 className="mb-1 text-base font-bold text-amber-900 dark:text-amber-200">
          {lang === "kn" ? "ಗೂಗಲ್ ಮ್ಯಾಪ್ಸ್ ಸಂಯೋಜನೆ ಸಂರಚನೆ" : "Google Maps Configuration Required"}
        </h3>
        <p className="mb-4 max-w-md text-xs text-amber-700 dark:text-amber-300">
          {loadError}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            onClick={onSwitchToCampusMap}
            className="gap-2 rounded-xl bg-primary text-primary-foreground font-semibold shadow-soft"
          >
            <Layers className="h-4 w-4" />
            {lang === "kn" ? "ಕ್ಯಾಂಪಸ್ ಮ್ಯಾಪ್ ಬಳಸಿ" : "Open Indoor Campus Map"}
          </Button>
          <Button
            variant="outline"
            onClick={openInGoogleMapsApp}
            className="gap-2 rounded-xl border-amber-300 text-amber-900 dark:border-amber-800 dark:text-amber-200"
          >
            <ExternalLink className="h-4 w-4" />
            {lang === "kn" ? "ಗೂಗಲ್ ಮ್ಯಾಪ್ಸ್ ಆಪ್‌ನಲ್ಲಿ ತೆರೆಯಿರಿ" : "Open in Google Maps App"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[480px] sm:h-[540px] w-full overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
      {/* Top Overlay Banner */}
      <div className="absolute top-3 left-3 right-3 z-10 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-background/90 px-3.5 py-2.5 shadow-soft backdrop-blur border border-border">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5 border-primary/30 bg-primary/10 text-primary font-bold text-xs py-1">
              <Navigation className="h-3.5 w-3.5 animate-pulse" />
              {lang === "kn" ? "ಹೊರಾಂಗಣ ಮೋಡ್" : "Outdoor Mode"}
            </Badge>
            {roadDistanceMeters != null && (
              <span className="text-xs font-bold text-foreground">
                {formatCampusDistance(roadDistanceMeters, lang)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={onSwitchToCampusMap}
              className="h-8 gap-1.5 rounded-xl bg-gradient-primary text-primary-foreground font-semibold text-xs shadow-soft"
            >
              <Layers className="h-3.5 w-3.5" />
              {lang === "kn" ? "ಕ್ಯಾಂಪಸ್ ನಕ್ಷೆಗೆ ಹೋಗಿ" : "Switch to Campus Map"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={openInGoogleMapsApp}
              title="Open in external Google Maps app"
              className="h-8 px-2.5 rounded-xl border-border"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {apiNotice && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-500/90 text-amber-950 px-3 py-1.5 text-[11px] font-medium shadow-soft backdrop-blur">
            <span className="truncate">{apiNotice}</span>
            <button
              onClick={openInGoogleMapsApp}
              className="underline font-bold shrink-0 hover:text-black"
            >
              {lang === "kn" ? "ಆಪ್‌ನಲ್ಲಿ ತೆರೆಯಿರಿ" : "Open App"}
            </button>
          </div>
        )}
      </div>

      {/* Loading Spinner */}
      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/80 backdrop-blur">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mb-2" />
          <p className="text-xs font-medium text-muted-foreground">
            {lang === "kn" ? "ಗೂಗಲ್ ಮ್ಯಾಪ್ಸ್ ಲೋಡ್ ಆಗುತ್ತಿದೆ..." : "Loading Google Maps..."}
          </p>
        </div>
      )}

      {/* Map Container */}
      <div ref={mapContainerRef} className="h-full w-full" />

      {/* Bottom Info Floating Card */}
      <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between gap-2 rounded-2xl bg-background/95 px-3.5 py-2.5 shadow-soft border border-border">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground font-bold">
            <MapPin className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-foreground truncate">
              {campusTarget.name}
            </p>
            <p className="text-[11px] font-medium text-muted-foreground truncate">
              {roadDistanceMeters != null
                ? formatCampusDistance(roadDistanceMeters, lang)
                : userPosition
                ? lang === "kn" ? "ಮಾರ್ಗದ ದೂರ ಲೆಕ್ಕಹಾಕಲಾಗುತ್ತಿದೆ..." : "Calculating road distance..."
                : lang === "kn" ? "ನಿಮ್ಮ ಸ್ಥಳ ಪಡೆಯಲಾಗುತ್ತಿದೆ..." : "Waiting for GPS position..."}
            </p>
          </div>
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (mapInstanceRef.current && userPosition) {
              mapInstanceRef.current.panTo({ lat: userPosition.lat, lng: userPosition.lng });
              mapInstanceRef.current.setZoom(16);
            }
          }}
          className="h-8 gap-1.5 rounded-xl text-xs shrink-0 font-medium"
        >
          <Compass className="h-3.5 w-3.5" />
          {lang === "kn" ? "ನನ್ನ ಸ್ಥಳ" : "Recenter"}
        </Button>
      </div>
    </div>
  );
};

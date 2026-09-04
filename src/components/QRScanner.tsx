import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Flashlight,
  FlashlightOff,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Navigation,
  QrCode,
  RefreshCw,
  Sparkles,
  SwitchCamera,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CampusLocation, Language } from "@/data/locations";
import { getLocationName } from "@/data/locations";
import { floorLabelName } from "@/lib/navigationInstructions";
import { playScanSuccessSound } from "@/lib/sound";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  locations: CampusLocation[];
  lang: Language;
  onSelectStart?: (locationId: string) => void;
  onSelectDestination?: (locationId: string) => void;
  onSelectRoute?: (startId: string, destId: string) => void;
  onViewLocation?: (location: CampusLocation) => void;
  currentDestinationId?: string;
}

const SCANNER_CONTAINER_ID = "campusnav-html5-qr-reader";

interface ResolvedScan {
  raw: string;
  startLocation?: CampusLocation;
  destLocation?: CampusLocation;
  isUnknown?: boolean;
}

export function QRScanner({
  open,
  onClose,
  locations,
  lang,
  onSelectStart,
  onSelectDestination,
  onSelectRoute,
  onViewLocation,
}: Props) {
  const scannerInstanceRef = useRef<Html5Qrcode | null>(null);
  const isTransitioningRef = useRef(false);
  const isMountedRef = useRef(false);
  const scannedFlagRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isStarting, setIsStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraIndex, setSelectedCameraIndex] = useState(0);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [activeTab, setActiveTab] = useState<"camera" | "upload">("camera");
  const [resolvedResult, setResolvedResult] = useState<ResolvedScan | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  const safeLocations = useMemo(
    () => (Array.isArray(locations) ? locations : []),
    [locations]
  );

  // Helper to safely match string against location database
  const findLocationByToken = useCallback(
    (token: string): CampusLocation | undefined => {
      if (!token || typeof token !== "string") return undefined;
      const clean = token.trim().toLowerCase();
      if (!clean) return undefined;

      // 1. Exact match on id or slug
      const byIdOrSlug = safeLocations.find(
        (l) =>
          l &&
          ((l.id && String(l.id).toLowerCase() === clean) ||
            (l.slug && String(l.slug).toLowerCase() === clean))
      );
      if (byIdOrSlug) return byIdOrSlug;

      // 2. Match name.en or name.kn
      const byName = safeLocations.find((l) => {
        if (!l) return false;
        const en = l.name?.en ? String(l.name.en).toLowerCase() : "";
        const kn = l.name?.kn ? String(l.name.kn).toLowerCase() : "";
        const enSlug = en.replace(/\s+/g, "-");
        return en === clean || kn === clean || enSlug === clean;
      });
      if (byName) return byName;

      // 3. Partial fuzzy search
      return safeLocations.find((l) => {
        if (!l) return false;
        const id = l.id ? String(l.id).toLowerCase() : "";
        const slug = l.slug ? String(l.slug).toLowerCase() : "";
        const en = l.name?.en ? String(l.name.en).toLowerCase() : "";
        const kn = l.name?.kn ? String(l.name.kn).toLowerCase() : "";

        return (
          (id && clean.includes(id)) ||
          (slug && clean.includes(slug)) ||
          (en && clean.includes(en)) ||
          (kn && clean.includes(kn))
        );
      });
    },
    [safeLocations]
  );

  // Parse any text, URL, deep link, or JSON into start and destination locations
  const parseScannedText = useCallback(
    (text: string): ResolvedScan => {
      if (!text || typeof text !== "string") return { raw: "", isUnknown: true };
      const raw = text.trim();

      // 1. JSON payload check
      if (raw.startsWith("{") && raw.endsWith("}")) {
        try {
          const obj = JSON.parse(raw);
          const startToken = obj.location || obj.start || obj.from || obj.id || obj.slug;
          const destToken = obj.destination || obj.dest || obj.to;

          const startLoc = startToken ? findLocationByToken(String(startToken)) : undefined;
          const destLoc = destToken ? findLocationByToken(String(destToken)) : undefined;

          if (startLoc || destLoc) {
            return { raw, startLocation: startLoc, destLocation: destLoc };
          }
        } catch {
          /* not JSON */
        }
      }

      // 2. URL parsing check
      try {
        const url = new URL(raw);
        const locParam =
          url.searchParams.get("location") ||
          url.searchParams.get("loc") ||
          url.searchParams.get("start") ||
          url.searchParams.get("from") ||
          url.searchParams.get("tag");

        const destParam =
          url.searchParams.get("destination") ||
          url.searchParams.get("dest") ||
          url.searchParams.get("to") ||
          url.searchParams.get("target");

        const startLoc = locParam ? findLocationByToken(locParam) : undefined;
        const destLoc = destParam ? findLocationByToken(destParam) : undefined;

        if (startLoc || destLoc) {
          return { raw, startLocation: startLoc, destLocation: destLoc };
        }

        // Check URL pathname (e.g. /location/audi or /nav/entrance)
        const pathSegments = url.pathname.split("/").filter(Boolean);
        if (pathSegments.length > 0) {
          const lastSeg = pathSegments[pathSegments.length - 1];
          const matched = findLocationByToken(lastSeg);
          if (matched) return { raw, startLocation: matched };
        }
      } catch {
        /* not a full URL */
      }

      // 3. Key-value string check: "location=audi" or "start:gate;to:canteen"
      const startMatch = raw.match(/(?:location|loc|start|from|tag)[=:]\s*([a-z0-9-_]+)/i);
      const destMatch = raw.match(/(?:destination|dest|to|target)[=:]\s*([a-z0-9-_]+)/i);

      const startLoc = startMatch ? findLocationByToken(startMatch[1]) : undefined;
      const destLoc = destMatch ? findLocationByToken(destMatch[1]) : undefined;

      if (startLoc || destLoc) {
        return { raw, startLocation: startLoc, destLocation: destLoc };
      }

      // 4. Raw token match against location database
      const matched = findLocationByToken(raw);
      if (matched) {
        return { raw, startLocation: matched };
      }

      return { raw, isUnknown: true };
    },
    [findLocationByToken]
  );

  // Trigger feedback and handle scan result
  const handleDecodedText = useCallback(
    (decodedText: string) => {
      // Play audio chime and haptic feedback
      try {
        playScanSuccessSound();
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate([40, 50, 40]);
        }
      } catch {
        /* ignore audio/vibration errors */
      }

      const res = parseScannedText(decodedText);
      setResolvedResult(res);
    },
    [parseScannedText]
  );

  // Safe stop helper that ensures no concurrent state transition errors
  const safeStopScanner = useCallback(async () => {
    const instance = scannerInstanceRef.current;
    if (!instance) return;

    try {
      // Html5Qrcode.isScanning is true when active
      if (instance.isScanning) {
        await instance.stop();
      }
    } catch {
      // Safely suppress transition errors during teardown
    } finally {
      try {
        instance.clear();
      } catch {
        // Ignore clear errors
      }
      scannerInstanceRef.current = null;
    }
  }, []);

  // Safe start scanner helper with state machine protection
  const startScannerWithCamera = useCallback(
    async (cameraId?: string) => {
      if (isTransitioningRef.current) return;
      isTransitioningRef.current = true;
      setIsStarting(true);
      setCameraError(null);
      setResolvedResult(null);

      try {
        await safeStopScanner();

        if (!isMountedRef.current) {
          return;
        }

        const container = document.getElementById(SCANNER_CONTAINER_ID);
        if (!container) {
          return;
        }

        const scanner = new Html5Qrcode(SCANNER_CONTAINER_ID, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
            Html5QrcodeSupportedFormats.AZTEC,
          ],
          verbose: false,
        });
        scannerInstanceRef.current = scanner;

        const cameraConfig = cameraId
          ? { deviceId: { exact: cameraId } }
          : { facingMode: "environment" };

        await scanner.start(
          cameraConfig,
          {
            fps: 12,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const minDim = Math.min(viewfinderWidth, viewfinderHeight);
              const size = Math.floor(minDim * 0.72);
              return { width: size, height: size };
            },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            if (!isMountedRef.current || scannedFlagRef.current) return;
            scannedFlagRef.current = true;
            handleDecodedText(decodedText);
          },
          () => {
            // Frame ticker
          }
        );

        if (!isMountedRef.current) {
          await safeStopScanner();
          return;
        }

        // Check torch capability safely
        try {
          const capabilities = scanner.getRunningTrackCameraCapabilities() as any;
          setHasTorch(Boolean(capabilities?.torchFeature?.() || capabilities?.torch));
        } catch {
          setHasTorch(false);
        }
      } catch (err: any) {
        console.warn("[QRScanner] Camera start note:", err);
        if (isMountedRef.current) {
          const msg = String(err?.message || err);
          if (msg.includes("NotAllowedError") || msg.includes("Permission")) {
            setCameraError("Camera permission denied. Please allow camera access in your browser address bar.");
          } else if (msg.includes("NotFoundError") || msg.includes("DevicesNotFoundError")) {
            setCameraError("No camera found on this device.");
          } else if (!msg.includes("transition")) {
            setCameraError("Could not access camera. Please check permissions or upload a QR image.");
          }
        }
      } finally {
        isTransitioningRef.current = false;
        if (isMountedRef.current) {
          setIsStarting(false);
        }
      }
    },
    [handleDecodedText, safeStopScanner]
  );

  // Toggle flashlight / torch
  const toggleTorch = async () => {
    const instance = scannerInstanceRef.current;
    if (!instance || !instance.isScanning) return;
    try {
      const nextState = !torchOn;
      await instance.applyVideoConstraints({
        advanced: [{ torch: nextState }] as any,
      });
      setTorchOn(nextState);
    } catch (e) {
      console.warn("Torch not supported:", e);
      toast.error("Flashlight is not supported on this camera.");
    }
  };

  // Flip / switch camera safely
  const switchCamera = async () => {
    if (cameras.length <= 1 || isTransitioningRef.current) return;
    const nextIdx = (selectedCameraIndex + 1) % cameras.length;
    setSelectedCameraIndex(nextIdx);
    setTorchOn(false);
    scannedFlagRef.current = false;
    setResolvedResult(null);

    await startScannerWithCamera(cameras[nextIdx].id);
  };

  // Lifecycle when modal opens/closes
  useEffect(() => {
    if (!open) {
      isMountedRef.current = false;
      scannedFlagRef.current = false;
      setResolvedResult(null);
      setCameraError(null);
      setTorchOn(false);
      void safeStopScanner();
      return;
    }

    isMountedRef.current = true;
    scannedFlagRef.current = false;
    let isCancelled = false;

    // Small delay to ensure Radix Dialog DOM container is fully mounted
    const timer = setTimeout(() => {
      if (isCancelled || !isMountedRef.current) return;

      Html5Qrcode.getCameras()
        .then((devices) => {
          if (isCancelled || !isMountedRef.current) return;
          if (devices && devices.length > 0) {
            setCameras(devices);
            const backIdx = devices.findIndex((d) =>
              d.label.toLowerCase().includes("back") ||
              d.label.toLowerCase().includes("rear") ||
              d.label.toLowerCase().includes("environment")
            );
            const initIdx = backIdx !== -1 ? backIdx : 0;
            setSelectedCameraIndex(initIdx);
            void startScannerWithCamera(devices[initIdx].id);
          } else {
            void startScannerWithCamera();
          }
        })
        .catch(() => {
          if (isCancelled || !isMountedRef.current) return;
          void startScannerWithCamera();
        });
    }, 150);

    return () => {
      isCancelled = true;
      isMountedRef.current = false;
      clearTimeout(timer);
      void safeStopScanner();
    };
  }, [open, safeStopScanner, startScannerWithCamera]);

  // Handle image file scan
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingFile(true);
    setCameraError(null);

    try {
      const fileContainer = document.getElementById("campusnav-file-reader-hidden");
      if (!fileContainer) return;

      const html5QrCode = new Html5Qrcode("campusnav-file-reader-hidden", { verbose: false });
      try {
        const decodedText = await html5QrCode.scanFile(file, true);
        scannedFlagRef.current = true;
        handleDecodedText(decodedText);
        toast.success("QR code detected from image!");
      } finally {
        try {
          html5QrCode.clear();
        } catch {
          // Ignore
        }
      }
    } catch (err: any) {
      console.warn("[QRScanner] File scan note:", err);
      toast.error("No valid QR code found in the selected image. Please try another photo.");
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Resume scanning without state machine restarts
  const handleScanAgain = () => {
    scannedFlagRef.current = false;
    setResolvedResult(null);
  };

  // Action handlers
  const handleConfirmStart = (loc: CampusLocation) => {
    onSelectStart?.(loc.id);
    toast.success(`Starting point set: ${getLocationName(loc, lang)}`);
    onClose();
  };

  const handleConfirmDestination = (loc: CampusLocation) => {
    onSelectDestination?.(loc.id);
    toast.success(`Destination set: ${getLocationName(loc, lang)}`);
    onClose();
  };

  const handleConfirmRoute = (startLoc: CampusLocation, destLoc: CampusLocation) => {
    if (onSelectRoute) {
      onSelectRoute(startLoc.id, destLoc.id);
    } else {
      onSelectStart?.(startLoc.id);
      onSelectDestination?.(destLoc.id);
    }
    toast.success(
      `Route loaded: ${getLocationName(startLoc, lang)} → ${getLocationName(destLoc, lang)}`
    );
    onClose();
  };

  // Sample quick test tags for instant in-browser testing
  const sampleTestLocations = safeLocations.filter((l) => l && !l.hidden).slice(0, 4);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        id="campus-qr-scanner-modal"
        className="max-w-md p-0 overflow-hidden rounded-3xl border-border bg-card shadow-2xl"
      >
        {/* Hidden container for file decoding */}
        <div id="campusnav-file-reader-hidden" className="hidden" />

        <DialogHeader className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <QrCode className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold">
                  {lang === "kn" ? "ಕ್ಯಾಂಪಸ್ ಕ್ಯೂಆರ್ ಸ್ಕ್ಯಾನರ್" : "Campus QR Scanner"}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {lang === "kn"
                    ? "ನಿಮ್ಮ ಸ್ಥಳ ಅಥವಾ ಮಾರ್ಗವನ್ನು ಗುರುತಿಸಲು ಕ್ಯೂಆರ್ ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ"
                    : "Scan any location tag or plaque on campus"}
                </DialogDescription>
              </div>
            </div>

            {/* Mode switch tabs */}
            <div className="flex items-center gap-1 rounded-xl bg-muted/60 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("camera")}
                className={cn(
                  "flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold transition-all",
                  activeTab === "camera"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Camera className="h-3.5 w-3.5" />
                {lang === "kn" ? "ಕ್ಯಾಮೆರಾ" : "Live Camera"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("upload");
                  fileInputRef.current?.click();
                }}
                className={cn(
                  "flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold transition-all",
                  activeTab === "upload"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                {lang === "kn" ? "ಫೋಟೋ" : "Upload"}
              </button>
            </div>
          </div>
        </DialogHeader>

        {safeLocations.length === 0 && (
          <div className="mx-4 mb-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs font-semibold text-amber-700 dark:text-amber-300">
            Campus Navigation is temporarily unavailable.
          </div>
        )}

        {/* Scanner Viewport */}
        <div className="relative mx-4 mb-3 overflow-hidden rounded-2xl border border-border/80 bg-black aspect-[4/3] sm:aspect-square flex items-center justify-center">
          {/* HTML5 QR Container */}
          <div
            id={SCANNER_CONTAINER_ID}
            className="h-full w-full [&_video]:!h-full [&_video]:!w-full [&_video]:object-cover"
          />

          {/* Scanner Overlay UI (Reticle & Laser Line) */}
          {!resolvedResult && !cameraError && !isStarting && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              {/* Corner brackets */}
              <div className="relative h-48 w-48 sm:h-56 sm:w-56 rounded-2xl border-2 border-primary/40">
                {/* 4 sharp corner accents */}
                <div className="absolute -left-1 -top-1 h-6 w-6 border-l-4 border-t-4 border-primary rounded-tl-lg" />
                <div className="absolute -right-1 -top-1 h-6 w-6 border-r-4 border-t-4 border-primary rounded-tr-lg" />
                <div className="absolute -left-1 -bottom-1 h-6 w-6 border-l-4 border-b-4 border-primary rounded-bl-lg" />
                <div className="absolute -right-1 -bottom-1 h-6 w-6 border-r-4 border-b-4 border-primary rounded-br-lg" />

                {/* Animated scanning laser */}
                <div className="absolute inset-x-2 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent animate-scan shadow-glow" />
              </div>

              <div className="mt-4 rounded-full bg-black/70 px-3.5 py-1 text-[11px] font-semibold text-white/90 backdrop-blur shadow-sm">
                {lang === "kn" ? "ಕ್ಯೂಆರ್ ಕೋಡ್ ಅನ್ನು ಚೌಕಟ್ಟಿನಲ್ಲಿ ಇರಿಸಿ" : "Align QR tag inside frame"}
              </div>
            </div>
          )}

          {/* Camera Controls Overlay */}
          {!resolvedResult && !cameraError && (
            <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5">
              {hasTorch && (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  onClick={toggleTorch}
                  aria-label="Toggle Flashlight"
                  className={cn(
                    "h-8 w-8 rounded-xl bg-black/60 text-white backdrop-blur hover:bg-black/80 border border-white/10",
                    torchOn && "bg-amber-500 text-black hover:bg-amber-400"
                  )}
                >
                  {torchOn ? <Flashlight className="h-4 w-4" /> : <FlashlightOff className="h-4 w-4" />}
                </Button>
              )}

              {cameras.length > 1 && (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  onClick={switchCamera}
                  aria-label="Switch Camera"
                  className="h-8 w-8 rounded-xl bg-black/60 text-white backdrop-blur hover:bg-black/80 border border-white/10"
                >
                  <SwitchCamera className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}

          {/* Loading Indicator */}
          {(isStarting || isProcessingFile) && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/70 backdrop-blur-xs text-white">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
              <p className="text-xs font-semibold">
                {isProcessingFile
                  ? lang === "kn" ? "ಚಿತ್ರವನ್ನು ವಿಶ್ಲೇಷಿಸಲಾಗುತ್ತಿದೆ..." : "Analyzing QR from image..."
                  : lang === "kn" ? "ಕ್ಯಾಮೆರಾ ಪ್ರಾರಂಭಿಸಲಾಗುತ್ತಿದೆ..." : "Starting camera..."}
              </p>
            </div>
          )}

          {/* Camera Error Display */}
          {cameraError && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center bg-black/90 text-white">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/20 text-destructive mb-3">
                <CameraOff className="h-6 w-6" />
              </div>
              <h4 className="text-sm font-bold text-destructive-foreground mb-1">
                {lang === "kn" ? "ಕ್ಯಾಮೆರಾ ಪ್ರವೇಶಿಸಲು ಸಾಧ್ಯವಾಗುತ್ತಿಲ್ಲ" : "Camera Access Needed"}
              </h4>
              <p className="text-xs text-muted-foreground max-w-xs mb-4">
                {cameraError}
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => startScannerWithCamera()}
                  className="gap-1.5 rounded-xl text-xs"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {lang === "kn" ? "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ" : "Try Again"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setActiveTab("upload");
                    fileInputRef.current?.click();
                  }}
                  className="gap-1.5 rounded-xl text-xs border-white/20 text-white hover:bg-white/10"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  {lang === "kn" ? "ಫೋಟೋದಿಂದ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ" : "Scan Image File"}
                </Button>
              </div>
            </div>
          )}

          {/* Hidden File Input for Image Scanning */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Scan Result Action Card (Appears after successful scan) */}
        {resolvedResult && (
          <div className="px-4 pb-2 animate-float-in">
            {resolvedResult.startLocation && resolvedResult.destLocation ? (
              // Route Decoded (Both Start & Destination)
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{lang === "kn" ? "ಸಂಪೂರ್ಣ ಮಾರ್ಗ ಪತ್ತೆಯಾಗಿದೆ!" : "Campus Route Found!"}</span>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-xl bg-background p-3 border border-border text-sm">
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase">
                      {lang === "kn" ? "ಪ್ರಾರಂಭ" : "From"}
                    </p>
                    <p className="font-bold text-foreground">
                      {getLocationName(resolvedResult.startLocation, lang)}
                    </p>
                  </div>
                  <div className="text-primary font-bold">→</div>
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase">
                      {lang === "kn" ? "ಗಮ್ಯಸ್ಥಾನ" : "To"}
                    </p>
                    <p className="font-bold text-foreground">
                      {getLocationName(resolvedResult.destLocation, lang)}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() =>
                      handleConfirmRoute(
                        resolvedResult.startLocation!,
                        resolvedResult.destLocation!
                      )
                    }
                    className="flex-1 gap-2 rounded-xl bg-gradient-primary text-primary-foreground font-semibold shadow-soft"
                  >
                    <Navigation className="h-4 w-4" />
                    {lang === "kn" ? "ಮಾರ್ಗವನ್ನು ಪ್ರಾರಂಭಿಸಿ" : "Start Navigation"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleScanAgain}
                    className="rounded-xl"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : resolvedResult.startLocation ? (
              // Single Location Tag Decoded
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <span className="text-xs font-bold text-primary uppercase tracking-wider">
                      {lang === "kn" ? "ಸ್ಥಳ ಗುರುತಿಸಲಾಗಿದೆ" : "Location Identified"}
                    </span>
                  </div>
                  <Badge variant="secondary" className="rounded-lg text-[11px] font-semibold">
                    {floorLabelName(resolvedResult.startLocation.floor ?? 0, lang)}
                  </Badge>
                </div>

                <div>
                  <h3 className="font-display text-lg font-bold text-foreground">
                    {getLocationName(resolvedResult.startLocation, lang)}
                  </h3>
                  {resolvedResult.startLocation.category && (
                    <p className="text-xs text-muted-foreground capitalize">
                      {resolvedResult.startLocation.category} • ID: {resolvedResult.startLocation.id}
                    </p>
                  )}
                </div>

                {/* Primary Action Buttons */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    onClick={() => handleConfirmStart(resolvedResult.startLocation!)}
                    className="gap-1.5 rounded-xl bg-primary text-primary-foreground font-semibold shadow-soft text-xs"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    {lang === "kn" ? "ಇಲ್ಲಿಂದ ಪ್ರಾರಂಭಿಸಿ" : "Start Route Here"}
                  </Button>

                  <Button
                    variant="secondary"
                    onClick={() => handleConfirmDestination(resolvedResult.startLocation!)}
                    className="gap-1.5 rounded-xl font-semibold text-xs border border-border"
                  >
                    <Navigation className="h-3.5 w-3.5" />
                    {lang === "kn" ? "ಇಲ್ಲಿಗೆ ಹೋಗಿ" : "Go To Here"}
                  </Button>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-border/60 text-xs">
                  {onViewLocation && (
                    <button
                      type="button"
                      onClick={() => {
                        onViewLocation(resolvedResult.startLocation!);
                        onClose();
                      }}
                      className="text-primary font-semibold hover:underline"
                    >
                      {lang === "kn" ? "ಸ್ಥಳದ ವಿವರಗಳು" : "View place details"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleScanAgain}
                    className="ml-auto text-muted-foreground hover:text-foreground font-medium"
                  >
                    {lang === "kn" ? "ಬೇರೆ ಕ್ಯೂಆರ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ" : "Scan another code"}
                  </button>
                </div>
              </div>
            ) : (
              // Unrecognized QR Code
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                <div className="font-bold flex items-center gap-1.5">
                  <QrCode className="h-4 w-4 text-amber-600" />
                  {lang === "kn" ? "ಅಪರಿಚಿತ ಕ್ಯೂಆರ್ ಕೋಡ್" : "Non-Campus QR Code"}
                </div>
                <p className="font-mono text-[11px] break-all bg-background/80 p-2 rounded-lg border border-border text-foreground">
                  {resolvedResult.raw}
                </p>
                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={handleScanAgain} className="h-7 text-xs rounded-lg">
                    <RefreshCw className="h-3 w-3 mr-1" />
                    {lang === "kn" ? "ಮತ್ತೆ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ" : "Scan Again"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quick Test Demo Tags */}
        <div className="border-t border-border/80 bg-muted/20 px-5 py-3.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-primary" />
              {lang === "kn" ? "ಡೆಮೊ ಕ್ಯೂಆರ್ ಟ್ಯಾಗ್‌ಗಳು" : "Quick Test Sample QR Tags"}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sampleTestLocations.map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => handleDecodedText(`?location=${loc.slug || loc.id}`)}
                className="inline-flex items-center gap-1 rounded-xl border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-xs hover:border-primary hover:bg-primary/5 transition-all"
              >
                <MapPin className="h-3 w-3 text-primary" />
                <span>{getLocationName(loc, lang)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Bottom Footer */}
        <div className="flex items-center justify-between border-t border-border bg-muted/40 px-5 py-2.5">
          <span className="text-[11px] text-muted-foreground">
            {lang === "kn" ? "ಕ್ಯಾಂಪಸ್ ಟ್ಯಾಗ್ ಸ್ಕ್ಯಾನರ್" : "Camera QR Scanner"}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 gap-1 rounded-xl text-xs font-semibold">
            <X className="h-3.5 w-3.5" />
            {lang === "kn" ? "ಮುಚ್ಚಿ" : "Close"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

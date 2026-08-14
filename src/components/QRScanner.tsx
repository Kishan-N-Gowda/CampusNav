import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onClose: () => void;
  onResult: (slug: string, rawText: string) => void;
}

const ELEMENT_ID = "campusnav-qr-reader";

/** Extract a CampusNav slug from a scanned text or URL. */
function extractSlug(text: string): string | null {
  if (!text) return null;
  // Try parsing as URL first
  try {
    const url = new URL(text);
    const slug = url.searchParams.get("location");
    if (slug) return slug;
  } catch {
    /* not a URL */
  }
  // Plain "location=foo" or just a slug-ish token
  const m = text.match(/location=([a-z0-9-]+)/i);
  if (m) return m[1];
  if (/^[a-z0-9-]{2,64}$/i.test(text.trim())) return text.trim();
  return null;
}

export function QRScanner({ open, onClose, onResult }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setStarting(true);

    const start = async () => {
      try {
        const scanner = new Html5Qrcode(ELEMENT_ID, { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            const slug = extractSlug(decoded);
            if (slug) {
              // Stop ASAP — fire result once.
              scanner
                .stop()
                .catch(() => null)
                .finally(() => {
                  scanner.clear();
                  scannerRef.current = null;
                  onResult(slug, decoded);
                });
            }
          },
          () => {
            // ignore per-frame decode errors
          }
        );
        if (cancelled) {
          await scanner.stop().catch(() => null);
          scanner.clear();
          scannerRef.current = null;
        }
      } catch (e: any) {
        setError(
          e?.message ||
            "Could not access the camera. Check browser permissions and try again."
        );
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    // Defer one tick so the dialog DOM mounts the target div first.
    const id = window.setTimeout(start, 50);

    return () => {
      cancelled = true;
      window.clearTimeout(id);
      const s = scannerRef.current;
      if (s) {
        s.stop()
          .catch(() => null)
          .finally(() => {
            try {
              s.clear();
            } catch {
              /* ignore */
            }
            scannerRef.current = null;
          });
      }
    };
  }, [open, onResult]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Scan campus QR</DialogTitle>
          <DialogDescription>
            Point your camera at any CampusNav QR code to set your starting point.
          </DialogDescription>
        </DialogHeader>
        <div className="relative mx-5 mb-5 mt-3 overflow-hidden rounded-2xl border border-border bg-black">
          <div
            id={ELEMENT_ID}
            ref={containerRef}
            className="aspect-square w-full [&_video]:!h-full [&_video]:!w-full [&_video]:object-cover"
          />
          {/* Reticle overlay */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-3/5 w-3/5 rounded-2xl border-2 border-primary/80 shadow-glow" />
          </div>
          {starting && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-sm">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
          {error && (
            <div className="absolute inset-x-0 bottom-0 bg-destructive/90 px-4 py-3 text-xs text-destructive-foreground">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
          <Button variant="outline" onClick={onClose} className="gap-1.5">
            <X className="h-4 w-4" /> Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

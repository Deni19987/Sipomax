import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Loader2, X } from "lucide-react";
import { shareOrDownloadBlob } from "@/lib/pdf-download";

export type LightboxItem = {
  url: string;
  name: string;
  /** "image" or "video" — decides how the item is rendered. */
  kind: "image" | "video";
};

/**
 * Fullscreen media viewer for status-update attachments (images and videos in
 * one swipeable sequence). Opens on the tapped item; navigate with swipe
 * (touch), arrow buttons (pointer) or ←/→ keys; Esc or the X (or tapping the
 * backdrop) closes. Videos autoplay when focused — allowed with sound since
 * opening the lightbox is a user gesture — and stop when navigated away, so
 * only one thing plays at a time. Rendered in a portal so no ancestor
 * transform/overflow can clip or misplace it.
 */
export function MediaLightbox({
  items,
  index,
  onClose,
  onIndexChange,
}: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const count = items.length;
  const item = items[Math.min(Math.max(index, 0), count - 1)];

  const goTo = useCallback(
    (i: number) => {
      if (count < 2) return;
      onIndexChange((i + count) % count);
    },
    [count, onIndexChange],
  );

  // Keyboard: arrows navigate, Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") goTo(index + 1);
      else if (e.key === "ArrowLeft") goTo(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, goTo, onClose]);

  // Lock page scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function download() {
    if (!item || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(item.url);
      const blob = await res.blob();
      await shareOrDownloadBlob(blob, item.name);
    } catch {
      // Non-fatal — the media is still on screen.
    } finally {
      setDownloading(false);
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current == null || touchStartY.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    // Horizontal swipe only — ignore mostly-vertical gestures (scroll attempts)
    // and taps. 48px threshold avoids accidental navigation.
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    goTo(index + (dx < 0 ? 1 : -1));
  }

  if (!item || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col select-none"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Top bar: counter + actions. Stopping propagation so taps here never
          fall through to the backdrop-close handler. */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 text-white"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm tabular-nums text-white/80">
          {count > 1 ? `${index + 1} / ${count}` : " "}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={download}
            disabled={downloading}
            className="p-2.5 rounded-full hover:bg-white/10 active:bg-white/20 transition-colors disabled:opacity-50"
            title="Ladda ner"
          >
            {downloading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Download className="h-5 w-5" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-2.5 rounded-full hover:bg-white/10 active:bg-white/20 transition-colors"
            title="Stäng"
            aria-label="Stäng"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* Media area — clicking the empty backdrop closes, clicking the media
          itself doesn't. key={} remounts the element on navigation so a
          playing video is fully torn down before the next item mounts. */}
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center px-2 pb-2"
        onClick={onClose}
      >
        {item.kind === "video" ? (
          <video
            key={item.url}
            src={item.url}
            controls
            autoPlay
            playsInline
            preload="auto"
            className="max-h-full max-w-full rounded-md outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <img
            key={item.url}
            src={item.url}
            alt={item.name}
            decoding="async"
            className="max-h-full max-w-full object-contain rounded-md"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
          />
        )}

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goTo(index - 1);
              }}
              className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Föregående"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goTo(index + 1);
              }}
              className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Nästa"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>

      {/* Dot indicators on mobile (where the arrow buttons are hidden). */}
      {count > 1 && (
        <div
          className="sm:hidden flex items-center justify-center gap-1.5 pb-3"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          {items.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-white" : "w-1.5 bg-white/40"}`}
            />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * Grid gallery of image/video attachments that opens MediaLightbox on tap.
 * One attachment renders as a large single tile; several render as a
 * two-per-row grid of square tiles (comfortable tap targets on mobile).
 * Thumbnails lazy-load; videos only fetch metadata (first frame) until the
 * customer actually opens them, so the page stays fast on mobile data while
 * playback still streams at original quality.
 */
export function MediaGallery({ items }: { items: LightboxItem[] }) {
  const [open, setOpen] = useState<number | null>(null);

  if (items.length === 0) return null;

  const tile = (m: LightboxItem, i: number, cls: string) => (
    <button
      key={m.url}
      type="button"
      onClick={() => setOpen(i)}
      className={`group relative overflow-hidden rounded-xl border bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${cls}`}
      aria-label={`Öppna ${m.kind === "video" ? "video" : "bild"}: ${m.name}`}
    >
      {m.kind === "video" ? (
        <>
          {/* preload=metadata renders the first frame as a poster without
              downloading the file. pointer-events-none: the tile's button
              handles the tap; native controls live in the lightbox. */}
          <video
            src={m.url}
            preload="metadata"
            playsInline
            muted
            className="h-full w-full object-cover pointer-events-none"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform group-hover:scale-110 group-active:scale-95">
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 translate-x-0.5">
                <path d="M8 5.14v13.72c0 .86.94 1.39 1.68.94l10.9-6.86a1.1 1.1 0 0 0 0-1.88L9.68 4.2A1.1 1.1 0 0 0 8 5.14Z" />
              </svg>
            </span>
          </span>
        </>
      ) : (
        <img
          src={m.url}
          alt={m.name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      )}
    </button>
  );

  return (
    <>
      {items.length === 1 ? (
        tile(items[0], 0, "block w-full aspect-[4/3] sm:max-h-[440px]")
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {items.map((m, i) =>
            // With an odd count, let the first tile span the full row so the
            // grid closes without a hole — the lead photo gets hero treatment.
            tile(
              m,
              i,
              items.length % 2 === 1 && i === 0 ? "col-span-2 aspect-[16/9]" : "aspect-square",
            ),
          )}
        </div>
      )}
      {open != null && (
        <MediaLightbox
          items={items}
          index={open}
          onClose={() => setOpen(null)}
          onIndexChange={setOpen}
        />
      )}
    </>
  );
}

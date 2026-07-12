// Client-side helpers for opening/downloading documents. Shared between the
// workshop views and the customer portal so both get the same behavior.
//
// Platform notes (the reason this isn't just an <a download> click):
// - iOS Safari treats an anchor-download of a blob: URL inconsistently — it can
//   open a blank viewer or do nothing at all, and inside a standalone PWA
//   (which the workshop app is on iOS home screens) it is a reliable no-op.
// - The dependable mobile path is the Web Share API with the actual File:
//   the native sheet previews the document and offers "Spara i Filer" etc.
// - Where share isn't available, opening the blob URL in a tab shows the
//   browser's own viewer (with its download/share controls).
// - All of these need a live user gesture, so call these synchronously from
//   the click handler with the bytes already in memory (prefetch them —
//   awaiting a network fetch between click and share loses the gesture).
export async function shareOrDownloadBlob(blob: Blob, filename: string): Promise<void> {
  const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;

  if (
    isTouch &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  ) {
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err: unknown) {
        // AbortError = the user dismissed the sheet — that's a completed
        // interaction, not a failure. Anything else falls through to the
        // blob-URL strategies below.
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  // A tab with the blob URL renders the platform viewer. If the popup is
  // blocked (or we're in a context without window.open), fall back to an
  // anchor download — attached to the DOM before .click() so it fires
  // consistently across browsers.
  const win = window.open(url, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function openOrDownloadPdf(base64: string, filename: string): Promise<void> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  await shareOrDownloadBlob(new Blob([bytes], { type: "application/pdf" }), filename);
}

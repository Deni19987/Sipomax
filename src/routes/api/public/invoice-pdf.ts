import { createFileRoute } from "@tanstack/react-router";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { verifyJobAccess, supabaseAdmin } from "@/lib/customer.server";
import { resolveJobInvoicePdf } from "@/lib/invoice.server";

// Opens the job's finished invoice in the customer's browser. The PDF is
// re-rendered on demand from the job's frozen invoice snapshot — the same
// pipeline "Förhandsgranska" uses — instead of trusting bytes archived at
// send time. The fresh PDF is uploaded to Storage under a unique path (a
// fixed path can be served stale by the CDN after an overwrite) and the
// response is a 302 redirect to a short-lived signed URL, which every
// browser opens in its native PDF viewer.
//
// Access is gated exactly like the rest of the customer portal: the job's
// share token plus the customer's phone number.

const BUCKET = "job-attachments";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

// True when the PDF's content streams contain at least one text-showing
// operator (Tj / TJ / ' / "). Used by ?debug=1 to diagnose a document without
// downloading it. Any parse failure counts as "has text".
function pdfHasText(bytes: Buffer): boolean {
  try {
    const TEXT_OPS = /\b(?:Tj|TJ)\b|\)\s*'|\)\s*"/;
    const raw = bytes.toString("latin1");
    if (!/stream/.test(raw)) return true;
    let idx = 0;
    while (true) {
      const m = raw.indexOf("stream", idx);
      if (m === -1) break;
      // "stream" also matches the tail of "endstream" — skip those hits.
      if (raw.slice(Math.max(0, m - 3), m) === "end") {
        idx = m + 6;
        continue;
      }
      const start = m + ("stream".length + (raw[m + 6] === "\r" ? 2 : 1));
      const end = raw.indexOf("endstream", start);
      if (end === -1) break;
      const chunk = bytes.subarray(start, end);
      try {
        if (TEXT_OPS.test(inflateSync(chunk).toString("latin1"))) return true;
      } catch {
        // Not deflate-compressed — check the raw stream body instead.
        if (TEXT_OPS.test(chunk.toString("latin1"))) return true;
      }
      idx = end;
    }
    return false;
  } catch {
    return true;
  }
}

export const Route = createFileRoute("/api/public/invoice-pdf")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";
        const credential = url.searchParams.get("credential") ?? "";
        const debug = url.searchParams.get("debug") === "1";
        if (!token || !credential) {
          return new Response("Ogiltig länk.", { status: 400 });
        }

        let job: Awaited<ReturnType<typeof verifyJobAccess>>;
        try {
          job = await verifyJobAccess(token, credential);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Åtkomst nekad.";
          return new Response(msg, { status: 403 });
        }

        try {
          const { invoiceId, pdfBase64, source } = await resolveJobInvoicePdf(job);
          const bytes = Buffer.from(pdfBase64, "base64");

          // Temporary diagnostics (see client-log endpoint): record what was
          // actually served so the client trace and server reality can be
          // compared in one place. Best-effort only.
          void supabaseAdmin
            .from("client_diagnostics" as any)
            .insert({
              session: "server",
              step: "invoice-pdf:served",
              detail: `job=${job.id} source=${source} bytes=${bytes.length} hasText=${pdfHasText(bytes)} snapshot=${!!(job as any).invoice_snapshot}`,
            })
            .then(({ error }: { error: unknown }) => {
              if (error) console.error("[invoice-pdf] diag insert failed", error);
            });

          // The object path is derived from the document's content (the frozen
          // snapshot, or the raw bytes for legacy blobs), NOT from a timestamp:
          // a timestamp path would upload a brand-new object on every single
          // open, growing the bucket forever. A content hash keeps the path
          // stable while the document is unchanged — so re-opens reuse the same
          // object — and any CDN-cached copy at that path is by construction
          // identical to what we would upload.
          const stamp = createHash("sha1")
            .update(
              (job as any).invoice_snapshot
                ? JSON.stringify((job as any).invoice_snapshot)
                : pdfBase64,
            )
            .digest("hex")
            .slice(0, 12);
          const path = `invoices/${job.id}/faktura-${invoiceId || "dokument"}-${stamp}.pdf`;
          const { error: uploadError } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(path, new Uint8Array(bytes), { contentType: "application/pdf", upsert: true });
          if (uploadError) {
            console.error("[invoice-pdf] storage upload failed", uploadError);
            return new Response(`Kunde inte förbereda fakturan: ${uploadError.message}`, {
              status: 500,
            });
          }
          const { data: signed, error: signError } = await supabaseAdmin.storage
            .from(BUCKET)
            .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
          if (signError || !signed?.signedUrl) {
            console.error("[invoice-pdf] signed url failed", signError);
            return new Response("Kunde inte förbereda fakturalänken.", { status: 500 });
          }

          if (debug) {
            return Response.json({
              source,
              invoiceId,
              bytes: bytes.length,
              header: bytes.subarray(0, 8).toString("latin1"),
              hasText: pdfHasText(bytes),
              hasSnapshot: !!(job as any).invoice_snapshot,
              storagePath: path,
              signedUrl: signed.signedUrl,
            });
          }

          return new Response(null, {
            status: 302,
            headers: {
              Location: signed.signedUrl,
              "Cache-Control": "private, no-store",
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Kunde inte hämta fakturan.";
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});

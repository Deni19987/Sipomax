import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendPickupThanksSms, sendStatusUpdateSms } from "./jobs.server";
import { getWorkshopId } from "./profile.server";
import {
  generateVismaInvoiceForJob,
  generateVismaInvoicePreviewPdfForJob,
  getVismaConnection,
  type InvoiceOverrides,
} from "./visma.server";
import {
  generateFortnoxInvoiceForJob,
  generateFortnoxInvoicePreviewPdfForJob,
  getFortnoxConnection,
  searchArticlesFromCache,
  searchFortnoxArticles,
  ensureFortnoxInvoiceFromArticles,
  buildLocalFortnoxInvoicePreview,
  getFortnoxInvoice,
  updateFortnoxCustomerDirect,
  markFortnoxInvoiceSent,
  bookkeepFortnoxInvoiceForJob,
  type FortnoxArticleLine,
  type FortnoxArticleResult,
  type ArticleInvoiceOverrides,
} from "./fortnox.server";
import { renderInvoicePdf, type InvoicePdfData } from "./invoice-pdf.server";
import type { ArticleLine } from "./articles";

export type InvoiceProvider = "visma" | "fortnox";

async function getPreferredProvider(userId: string): Promise<InvoiceProvider> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("invoice_provider")
    .eq("id", userId)
    .maybeSingle();
  return (data?.invoice_provider as InvoiceProvider) || "visma";
}

export async function setInvoiceProvider(userId: string, provider: InvoiceProvider) {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ invoice_provider: provider })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

export async function getInvoiceProviderStatus(userId: string) {
  const [preferred, visma, fortnox] = await Promise.all([
    getPreferredProvider(userId),
    getVismaConnection(userId),
    getFortnoxConnection(userId),
  ]);
  return {
    provider: preferred,
    visma_connected: !!visma,
    fortnox_connected: !!fortnox,
  };
}

// Resolve the integration that should actually be used for a job: honour the
// user's selected provider when it is connected, otherwise fall back to
// whichever integration is connected.
async function resolveActiveProvider(userId: string): Promise<InvoiceProvider> {
  const { provider, visma_connected, fortnox_connected } = await getInvoiceProviderStatus(userId);
  if (provider === "fortnox" && fortnox_connected) return "fortnox";
  if (provider === "visma" && visma_connected) return "visma";
  if (fortnox_connected) return "fortnox";
  if (visma_connected) return "visma";
  throw new Error("Ingen fakturaintegration är ansluten. Anslut Visma eller Fortnox i inställningarna.");
}

export async function generateInvoiceForJob(
  userId: string,
  jobId: string,
  overrides: InvoiceOverrides = {},
): Promise<{ invoiceId: string; provider: InvoiceProvider }> {
  const provider = await resolveActiveProvider(userId);
  const r = provider === "fortnox"
    ? await generateFortnoxInvoiceForJob(userId, jobId, overrides)
    : await generateVismaInvoiceForJob(userId, jobId, overrides);
  return { ...r, provider };
}

export async function generateInvoicePreviewPdfForJob(
  userId: string,
  jobId: string,
  overrides?: InvoiceOverrides,
): Promise<{ invoiceId: string; pdfBase64: string; provider: InvoiceProvider }> {
  const provider = await resolveActiveProvider(userId);
  const r = provider === "fortnox"
    ? await generateFortnoxInvoicePreviewPdfForJob(userId, jobId, overrides)
    : await generateVismaInvoicePreviewPdfForJob(userId, jobId, overrides);
  return { ...r, provider };
}

// ---------------------------------------------------------------------------
// Article-based Fortnox invoicing (push model)
// ---------------------------------------------------------------------------

// The company details that appear on the invoice PDF. All must be filled in
// (under Inställningar → Företagsprofil) before an invoice can be sent, so the
// customer never receives a document missing the workshop's identity/contact
// info. VAT number is intentionally optional (only some workshops are
// VAT-registered), matching how it's labelled "valfri" in Settings.
const REQUIRED_COMPANY_FIELDS: Array<{ key: string; label: string }> = [
  { key: "company_name", label: "Företagsnamn" },
  { key: "workshop_address", label: "Gatuadress" },
  { key: "company_zip_code", label: "Postnummer" },
  { key: "company_city", label: "Ort" },
  { key: "contact_phone", label: "Kontakt telefon" },
  { key: "contact_email", label: "Kontakt e-post" },
  { key: "company_org_number", label: "Organisationsnummer" },
];

export async function getCompanyProfileCompleteness(
  workshopId: string,
): Promise<{ complete: boolean; missing: string[] }> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("company_name, workshop_address, company_zip_code, company_city, contact_phone, contact_email, company_org_number, invoice_bank_details")
    .eq("id", workshopId)
    .maybeSingle();
  const missing = REQUIRED_COMPANY_FIELDS
    .filter((f) => !String((profile as any)?.[f.key] ?? "").trim())
    .map((f) => f.label);
  // At least one payment method must be present, otherwise the customer has no
  // way to pay the invoice. We require one of Bankgiro / Plusgiro / IBAN rather
  // than all, since a workshop normally uses just one.
  const bank = ((profile as any)?.invoice_bank_details ?? {}) as Record<string, string | null>;
  const hasPaymentMethod = [bank.bankgiro, bank.plusgiro, bank.iban].some((v) => String(v ?? "").trim());
  if (!hasPaymentMethod) missing.push("Betalsätt (Bankgiro, Plusgiro eller IBAN)");
  return { complete: missing.length === 0, missing };
}

// Guard used before an invoice is sent to the customer. Throws a clear,
// actionable message (in Swedish) listing exactly which fields are missing and
// where to fill them in.
async function assertCompanyProfileComplete(workshopId: string): Promise<void> {
  const { complete, missing } = await getCompanyProfileCompleteness(workshopId);
  if (!complete) {
    throw new Error(
      `Företagsuppgifter saknas: ${missing.join(", ")}. ` +
        `Fyll i dessa under Inställningar (Företagsprofil och Betalningsuppgifter) innan du skickar fakturan.`,
    );
  }
}

export async function searchArticlesForUser(userId: string, query: string): Promise<FortnoxArticleResult[]> {
  const fortnox = await getFortnoxConnection(userId);
  if (!fortnox) throw new Error("Fortnox är inte anslutet. Anslut Fortnox i inställningarna.");
  // `userId` here is the workshop id (resolved by the caller). Serve from the
  // local cache, which refreshes from Fortnox in the background when stale.
  const cached = await searchArticlesFromCache(userId, query);
  if (cached.length > 0) return cached;
  // Cache empty — fall back to a live Fortnox search so the user always
  // sees results even if the cache hasn't populated yet.
  return searchFortnoxArticles(userId, query);
}

export async function saveInvoiceArticlesForJob(userId: string, jobId: string, articles: ArticleLine[]): Promise<void> {
  const workshopId = await getWorkshopId(userId);
  const { error } = await supabaseAdmin
    .from("jobs")
    .update({ invoice_articles: articles } as any)
    .eq("id", jobId)
    .eq("workshop_id", workshopId);
  if (error) throw new Error(error.message);
}

function toFortnoxArticleLines(articles: ArticleLine[]): FortnoxArticleLine[] {
  return articles.map((a) => ({
    article_number: a.article_number,
    description: a.description,
    quantity: a.quantity,
    unit_price: a.unit_price,
    vat: a.vat,
  }));
}

// The customer number is what links a job to its customer. A job is locked to
// the customer it was created with: this only ever sets the link for a job that
// doesn't have one yet (e.g. legacy jobs), and never repoints an existing link
// at a different customer. Repointing used to leave the previous customer's
// name/phone/address on the job — so SMS went to the wrong number and the old
// customer could still open the portal — which is why changing the customer
// after creation is no longer allowed.
async function linkJobToCustomer(
  workshopId: string,
  jobId: string,
  customerNumber: string | null | undefined,
  currentNumber: string | null | undefined,
): Promise<void> {
  const num = (customerNumber ?? "").trim();
  const current = (currentNumber ?? "").trim();
  // Already linked, or nothing to link — leave the existing customer untouched.
  if (!num || current) return;
  await supabaseAdmin
    .from("jobs")
    .update({ fortnox_customer_number: num } as any)
    .eq("id", jobId)
    .eq("workshop_id", workshopId)
    // Guard against a concurrent link — only set it when it's still empty.
    .is("fortnox_customer_number", null);
}

// Render the Sipomax invoice PDF from a Fortnox-shaped invoice object (either a
// real Fortnox echo or a locally-built draft). Shared by preview and finalize.
// Assembles the complete, self-contained input for the invoice PDF render:
// the Fortnox invoice fields plus the workshop's company details as they are
// RIGHT NOW. This object is what gets frozen into jobs.invoice_snapshot at
// book/send — rendering from the snapshot later reproduces the document as
// issued even if the profile or Fortnox data change afterwards.
export async function buildInvoicePdfData(workshopId: string, inv: any, invoiceId: string): Promise<InvoicePdfData> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("company_name, company_zip_code, company_city, company_org_number, company_vat_number, contact_email, contact_phone, workshop_address, invoice_logo_url, invoice_bank_details, invoice_accent_color")
    .eq("id", workshopId)
    .maybeSingle();

  const rows = ((inv.InvoiceRows ?? []) as any[])
    .filter((r) => r?.ArticleNumber || Number(r?.Price) > 0)
    .map((r) => ({
      description: String(r.Description ?? ""),
      articleNumber: r.ArticleNumber ?? null,
      unit: r.Unit ?? null,
      quantity: Number(r.DeliveredQuantity ?? r.OrderedQuantity ?? r.Quantity ?? 0),
      price: Number(r.Price ?? 0),
      vat: Number(r.VAT ?? 25),
    }));

  const pdfData: InvoicePdfData = {
    invoiceId,
    ocr: inv.OCR ? String(inv.OCR) : null,
    invoiceDate: inv.InvoiceDate ?? null,
    dueDate: inv.DueDate ?? null,
    currency: inv.Currency ?? "SEK",
    customerNumber: inv.CustomerNumber ? String(inv.CustomerNumber) : null,
    ourReference: inv.OurReference ?? null,
    yourReference: inv.YourReference ?? null,
    paymentTerms: inv.TermsOfPayment ?? null,
    penaltyInterest: inv.PenaltyInterest ? `${inv.PenaltyInterest}%` : null,
    rows,
    net: Number(inv.Net ?? 0),
    vat: Number(inv.TotalVAT ?? inv.VAT ?? 0),
    total: Number(inv.Total ?? 0),
    customer: {
      name: String(inv.CustomerName ?? ""),
      address: inv.Address1 ?? null,
      zipCode: inv.ZipCode ?? null,
      city: inv.City ?? null,
      country: inv.Country ?? null,
      email: inv.EmailInformation?.EmailAddressTo ?? null,
    },
    company: {
      companyName: (profile as any)?.company_name ?? "",
      address: (profile as any)?.workshop_address ?? null,
      zipCode: (profile as any)?.company_zip_code ?? null,
      city: (profile as any)?.company_city ?? null,
      phone: (profile as any)?.contact_phone ?? null,
      email: (profile as any)?.contact_email ?? null,
      organisationNumber: (profile as any)?.company_org_number ?? null,
      vatNumber: (profile as any)?.company_vat_number ?? null,
    },
    settings: {
      logoUrl: (profile as any)?.invoice_logo_url ?? null,
      accentColor: (profile as any)?.invoice_accent_color ?? "#1a56db",
      bankDetails: (profile as any)?.invoice_bank_details ?? null,
    },
  };

  return pdfData;
}

async function renderJobInvoicePdf(workshopId: string, inv: any, invoiceId: string): Promise<string> {
  return renderInvoicePdf(await buildInvoicePdfData(workshopId, inv, invoiceId));
}

// Re-render a job's finished invoice from its frozen snapshot — the exact same
// pipeline "Förhandsgranska" uses, so what opens is what preview showed.
// Jobs invoiced before snapshots existed get one built from Fortnox (invoice
// data as issued) plus the current profile, written back exactly once. The
// archived PDF blob is only a last resort for jobs that predate everything.
export async function resolveJobInvoicePdf(
  job: any,
): Promise<{ invoiceId: string; pdfBase64: string; source: "snapshot" | "fortnox-backfill" | "stored" }> {
  const ownerId = (job.workshop_id ?? job.created_by) as string | null;
  const fortnoxInvoiceId = (job.fortnox_invoice_id as string | null)?.trim() || null;
  const invoiceId = fortnoxInvoiceId ?? String(job.visma_invoice_id ?? "");

  const snapshot = job.invoice_snapshot as InvoicePdfData | null;
  if (snapshot) {
    return { invoiceId, pdfBase64: await renderInvoicePdf(snapshot), source: "snapshot" };
  }

  if (fortnoxInvoiceId && ownerId) {
    try {
      const invoice = await getFortnoxInvoice(ownerId, fortnoxInvoiceId);
      if (invoice) {
        const pdfData = await buildInvoicePdfData(ownerId, invoice, fortnoxInvoiceId);
        // Write-once: `.is(null)` makes sure a concurrent open can't replace an
        // existing snapshot — the first one in wins, forever.
        await supabaseAdmin
          .from("jobs")
          .update({ invoice_snapshot: pdfData } as any)
          .eq("id", job.id)
          .is("invoice_snapshot", null);
        return { invoiceId, pdfBase64: await renderInvoicePdf(pdfData), source: "fortnox-backfill" };
      }
    } catch (e) {
      console.error("[invoice] snapshot backfill from Fortnox failed", e);
    }
  }

  const stored = (job.invoice_pdf_base64 as string | null) ?? null;
  if (stored) return { invoiceId, pdfBase64: stored, source: "stored" };
  throw new Error("Fakturan finns inte tillgänglig.");
}

// "Förhandsgranska": render a draft of how the invoice will look WITHOUT creating
// anything in Fortnox. Once a real invoice exists (created on book/send), mirror
// that instead — its number and OCR are then real. Before that, the draft shows
// empty Fakturanr/OCR because those don't exist until the invoice is created.
export async function previewFortnoxInvoiceForJob(
  userId: string,
  jobId: string,
  articles: ArticleLine[],
  overrides: ArticleInvoiceOverrides = {},
): Promise<{ invoiceId: string; invoice: any; pdfBase64: string }> {
  const fortnox = await getFortnoxConnection(userId);
  if (!fortnox) throw new Error("Fortnox är inte anslutet. Anslut Fortnox i inställningarna.");
  if (!articles.length) throw new Error("Lägg till minst en artikel innan du förhandsgranskar fakturan.");
  const workshopId = await getWorkshopId(userId);
  await saveInvoiceArticlesForJob(userId, jobId, articles);

  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .eq("workshop_id", workshopId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Jobbet hittades inte.");

  // Persist a "Byt kund" selection onto the job so the job↔customer link stays
  // correct everywhere, not just on this invoice.
  await linkJobToCustomer(workshopId, jobId, overrides.customerNumber, (job as any).fortnox_customer_number);

  const existingId = ((job as any).fortnox_invoice_id || "").trim();
  let invoice: any = null;
  let invoiceId = "";
  if (existingId) {
    // A real invoice already exists in Fortnox — mirror it (real number + OCR).
    const real = await getFortnoxInvoice(userId, existingId);
    const cancelled = real?.Cancelled === true || String(real?.Cancelled).toLowerCase() === "true";
    if (real && !cancelled) {
      invoice = real;
      invoiceId = existingId;
    }
  }
  if (!invoice) {
    // No invoice in Fortnox yet — build a local draft with empty number/OCR.
    invoice = await buildLocalFortnoxInvoicePreview(userId, job, toFortnoxArticleLines(articles), overrides);
    invoiceId = "";
  }

  const pdfBase64 = await renderJobInvoicePdf(workshopId, invoice, invoiceId);
  return { invoiceId, invoice, pdfBase64 };
}

export async function bookkeepInvoiceForJob(userId: string, jobId: string, invoiceId: string): Promise<void> {
  await bookkeepFortnoxInvoiceForJob(userId, invoiceId);
  const workshopId = await getWorkshopId(userId);
  await supabaseAdmin
    .from("jobs")
    .update({ invoice_bookkept_at: new Date().toISOString() } as any)
    .eq("id", jobId)
    .eq("workshop_id", workshopId);
}

export type InvoiceFinalizeAction = "book" | "send" | "book_send";

export async function finalizeFortnoxInvoiceForJob(
  userId: string,
  jobId: string,
  articles: ArticleLine[],
  action: InvoiceFinalizeAction,
  overrides: ArticleInvoiceOverrides = {},
): Promise<{ invoiceId: string; action: InvoiceFinalizeAction; total: number | null; pdfBase64: string }> {
  const fortnox = await getFortnoxConnection(userId);
  if (!fortnox) throw new Error("Fortnox är inte anslutet. Anslut Fortnox i inställningarna.");
  if (!articles.length) throw new Error("Lägg till minst en artikel innan du skapar fakturan.");

  const workshopId = await getWorkshopId(userId);
  // Before sending an invoice to the customer, the workshop's company details
  // must be complete — they appear on the invoice the customer receives.
  if (action === "send" || action === "book_send") {
    await assertCompanyProfileComplete(workshopId);
  }
  const { data: jobRow } = await supabaseAdmin
    .from("jobs")
    .select("fortnox_invoice_id, fortnox_customer_number, invoice_bookkept_at, invoice_pdf_base64")
    .eq("id", jobId)
    .eq("workshop_id", workshopId)
    .maybeSingle();
  const alreadyBookkept = !!(jobRow as any)?.invoice_bookkept_at;
  // Persist a "Byt kund" selection onto the job (the customer number is the link).
  await linkJobToCustomer(workshopId, jobId, overrides.customerNumber, (jobRow as any)?.fortnox_customer_number);

  const { data: sentUpdate } = await supabaseAdmin
    .from("status_updates")
    .select("id")
    .eq("job_id", jobId)
    .eq("status", "invoice_sent" as any)
    .limit(1)
    .maybeSingle();
  if ((action === "send" || action === "book_send") && sentUpdate) {
    throw new Error("Fakturan har redan skickats till kunden.");
  }
  if ((action === "book" || action === "book_send") && alreadyBookkept) {
    throw new Error("Fakturan är redan bokförd.");
  }

  // A booked Fortnox invoice is immutable — the normal create-or-update path
  // below would fail to reuse it and silently create a duplicate invoice.
  // "Skicka" after "Bokför" must therefore only notify the customer about
  // the existing invoice, never touch Fortnox.
  if (action === "send" && alreadyBookkept && (jobRow as any)?.fortnox_invoice_id) {
    const invoiceId = String((jobRow as any).fortnox_invoice_id);
    // Mark it as sent in Fortnox too, so its status matches reality.
    try {
      await markFortnoxInvoiceSent(userId, invoiceId);
    } catch (e) {
      console.error("Fortnox mark-sent failed:", e);
    }
    await supabaseAdmin.from("status_updates").insert({
      job_id: jobId,
      status: "invoice_sent" as any,
      description: `Faktura #${invoiceId}.`,
      created_by: userId,
    });
    try {
      await sendStatusUpdateSms(jobId, "invoice_sent", null);
    } catch (e) {
      console.error("Invoice sent SMS failed:", e);
    }
    return { invoiceId, action, total: null, pdfBase64: (jobRow as any)?.invoice_pdf_base64 ?? "" };
  }

  await saveInvoiceArticlesForJob(userId, jobId, articles);

  // Book/send is the point the real invoice is created in Fortnox (or the
  // existing draft is updated) — this is where the Fortnox invoice number and
  // OCR come into existence. "Förhandsgranska" never reaches this path.
  const { invoiceId, invoice } = await ensureFortnoxInvoiceFromArticles(
    userId,
    jobId,
    toFortnoxArticleLines(articles),
    overrides,
  );
  let fullInvoice = invoice ?? (await getFortnoxInvoice(userId, invoiceId));

  const bookkept = action === "book" || action === "book_send";
  if (bookkept) {
    await bookkeepFortnoxInvoiceForJob(userId, invoiceId);
    // Re-fetch after booking so the snapshot captures the invoice exactly as
    // Fortnox holds it at issue time (final number, OCR, balance, state).
    const booked = await getFortnoxInvoice(userId, invoiceId).catch(() => null);
    if (booked) fullInvoice = booked;
  }

  // Freeze the complete render input (Fortnox invoice + company profile) as
  // the job's invoice snapshot. Opening the invoice later re-renders from
  // this, so the customer's document stays exactly as issued. The render is
  // best-effort here: the invoice is already booked in Fortnox, and a PDF
  // hiccup must not fail the send — opening re-renders from the snapshot.
  const invoiceSnapshot = await buildInvoicePdfData(workshopId, fullInvoice ?? {}, invoiceId);
  let pdfBase64 = "";
  try {
    pdfBase64 = await renderInvoicePdf(invoiceSnapshot);
  } catch (e) {
    console.error("Invoice PDF render at send failed (snapshot saved, open re-renders):", e);
  }

  // Keep the customer's default payment terms in Fortnox in step with the terms
  // chosen on this invoice (Sipomax → Fortnox), so the two never drift apart.
  const custNumForTerms = overrides.customerNumber?.trim();
  if (custNumForTerms && overrides.paymentTerms) {
    await updateFortnoxCustomerDirect(userId, custNumForTerms, { termsOfPayment: overrides.paymentTerms })
      .catch((e) => console.error("Fortnox customer terms sync failed", e));
  }

  const { error: persistError } = await supabaseAdmin
    .from("jobs")
    .update({
      invoice_booked_at: new Date().toISOString(),
      invoice_pdf_base64: pdfBase64 || null,
      invoice_snapshot: invoiceSnapshot,
      ...(bookkept ? { invoice_bookkept_at: new Date().toISOString() } : {}),
    } as any)
    .eq("id", jobId)
    .eq("workshop_id", workshopId);
  if (persistError) console.error("Invoice snapshot persist failed:", persistError);

  const total = fullInvoice?.Total != null ? Number(fullInvoice.Total) : null;
  const statusForAction = action === "book" ? "invoice_booked" : "invoice_sent";
  // The "Fakturan har redan skickats" double-send guard above looks for this
  // row — a silently failed insert would disarm it, so the error must surface.
  const { error: statusError } = await supabaseAdmin.from("status_updates").insert({
    job_id: jobId,
    status: statusForAction as any,
    description: `Faktura #${invoiceId}` + (total != null ? ` – ${total} SEK` : "") + ".",
    created_by: userId,
  });
  if (statusError) console.error("Invoice status insert failed (double-send guard disarmed):", statusError);

  // Only notify the customer when the invoice is actually sent to them.
  if (action === "send" || action === "book_send") {
    // Mark it as sent in Fortnox so its status reflects that the customer has
    // received it (Sipomax delivers the PDF; this just updates Fortnox's view).
    try {
      await markFortnoxInvoiceSent(userId, invoiceId);
    } catch (e) {
      console.error("Fortnox mark-sent failed:", e);
    }
    try {
      await sendStatusUpdateSms(jobId, "invoice_sent", null);
    } catch (e) {
      console.error("Invoice sent SMS failed:", e);
    }
  }

  return { invoiceId, action, total, pdfBase64 };
}

// Provider-aware scheduled invoicing: for each due job, generate the invoice
// with the job owner's active integration, then auto-archive and notify.
export async function runDueInvoices(): Promise<{ processed: number; errors: number }> {
  const { data: jobs, error } = await supabaseAdmin
    .from("jobs")
    .select("id, created_by, workshop_id")
    .eq("current_status", "job_done")
    .lte("invoice_scheduled_at", new Date().toISOString())
    .is("invoice_generated_at", null);
  if (error) throw new Error(error.message);

  let processed = 0;
  let errors = 0;
  for (const j of jobs ?? []) {
    // Use workshop_id (the owner's user ID) so credentials are looked up on the right account.
    const effectiveUserId = (j as any).workshop_id ?? j.created_by;
    if (!effectiveUserId) continue;
    try {
      await generateInvoiceForJob(effectiveUserId, j.id);
      processed++;
      const { data: current } = await supabaseAdmin
        .from("jobs")
        .select("current_status, archived_at")
        .eq("id", j.id)
        .maybeSingle();
      if (current && current.current_status === "job_done" && !current.archived_at) {
        await supabaseAdmin.from("status_updates").insert({
          job_id: j.id,
          status: "car_picked_up",
          description: "Markerad upphämtad automatiskt när fakturan genererades.",
          created_by: effectiveUserId,
        });
        await supabaseAdmin
          .from("jobs")
          .update({
            current_status: "car_picked_up",
            archived_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", j.id);
        try {
          await sendPickupThanksSms(effectiveUserId, j.id);
        } catch (e) {
          console.error("Pickup SMS failed:", e);
        }
      }
    } catch (e: any) {
      errors++;
      await supabaseAdmin
        .from("jobs")
        .update({ invoice_error: (e?.message ?? "Unknown error").slice(0, 500) })
        .eq("id", j.id);
    }
  }
  return { processed, errors };
}

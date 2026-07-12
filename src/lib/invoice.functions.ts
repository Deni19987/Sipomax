import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiRewrite, previewInvoiceTextForJob } from "./visma.server";
import {
  generateInvoiceForJob,
  generateInvoicePreviewPdfForJob,
  getInvoiceProviderStatus,
  setInvoiceProvider,
  searchArticlesForUser,
  saveInvoiceArticlesForJob,
  previewFortnoxInvoiceForJob,
  finalizeFortnoxInvoiceForJob,
  bookkeepInvoiceForJob,
  getCompanyProfileCompleteness,
  resolveJobInvoicePdf,
} from "./invoice.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWorkshopId } from "./profile.server";
import {
  searchCustomersFromCache,
  searchFortnoxCustomers as searchFortnoxCustomersLive,
  createFortnoxArticle as createFortnoxArticleFn,
  createFortnoxCustomerDirect as createFortnoxCustomerDirectFn,
  updateFortnoxCustomerDirect as updateFortnoxCustomerDirectFn,
  updateFortnoxArticle as updateFortnoxArticleFn,
  deleteFortnoxArticle as deleteFortnoxArticleFn,
  cancelPreviewInvoice as cancelPreviewInvoiceFn,
  getFortnoxPaymentTerms as getFortnoxPaymentTermsFn,
  getFortnoxCustomerDefaults as getFortnoxCustomerDefaultsFn,
} from "./fortnox.server";

const OverridesSchema = z.object({
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  our_reference: z.string().max(200).optional(),
  your_reference: z.string().max(200).optional(),
  your_order_reference: z.string().max(200).optional(),
  is_credit_invoice: z.boolean().optional(),
  line_texts: z.array(z.string().max(500)).max(50).optional(),
  line_amounts: z.array(z.number().min(0).max(99999999)).max(50).optional(),
  summary_text: z.string().max(4000).nullable().optional(),
});

export const getInvoiceProviderStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return getInvoiceProviderStatus(await getWorkshopId(context.userId));
  });

export const getFortnoxPaymentTerms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return { terms: await getFortnoxPaymentTermsFn(await getWorkshopId(context.userId)) };
  });

// Whether the workshop's company profile has everything an invoice needs, so
// the invoice UI can warn before the user tries to send (points them to the
// exact fields to fill in).
export const getCompanyProfileStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return getCompanyProfileCompleteness(await getWorkshopId(context.userId));
  });

// Read a customer's default payment terms from Fortnox so the invoice UI can
// preselect them (Fortnox → Sipomax).
export const getFortnoxCustomerDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ customerNumber: z.string().min(1).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    return getFortnoxCustomerDefaultsFn(await getWorkshopId(context.userId), data.customerNumber);
  });

export const setActiveInvoiceProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ provider: z.enum(["visma", "fortnox"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await setInvoiceProvider(await getWorkshopId(context.userId), data.provider);
    return { ok: true };
  });

export const generateInvoiceNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      job_id: z.string().uuid(),
      overrides: OverridesSchema.optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    return generateInvoiceForJob(await getWorkshopId(context.userId), data.job_id, data.overrides ?? {});
  });

export const getInvoiceTextPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    return previewInvoiceTextForJob(data.job_id);
  });

export const rewriteInvoiceText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ text: z.string().min(1).max(4000) }).parse(d),
  )
  .handler(async ({ data }) => {
    const prompt = `Du skriver om en text till en kort, professionell svensk faktura-informationsrad. Behåll innehållet men gör texten tydlig, snygg och kort. Max 400 tecken. Inga priser. Returnera bara den nya texten.`;
    const rewritten = await aiRewrite(prompt, data.text);
    return { text: rewritten };
  });

export const generateInvoicePreviewPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      job_id: z.string().uuid(),
      overrides: OverridesSchema.optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const preview = await generateInvoicePreviewPdfForJob(await getWorkshopId(context.userId), data.job_id, data.overrides);
    return { invoice_id: preview.invoiceId, pdf_base64: preview.pdfBase64, provider: preview.provider };
  });

// ---------------------------------------------------------------------------
// Article-based invoicing (search Fortnox articles, build + send the invoice)
// ---------------------------------------------------------------------------

const ArticleLineSchema = z.object({
  article_number: z.string().max(80).nullable().optional(),
  description: z.string().max(200),
  quantity: z.number().min(0).max(1000000),
  unit_price: z.number().min(0).max(99999999),
  vat: z.number().min(0).max(100).nullable().optional(),
});

const ArticleLinesSchema = z.array(ArticleLineSchema).max(100);

function normalizeLines(lines: z.infer<typeof ArticleLinesSchema>) {
  return lines.map((l) => ({
    article_number: l.article_number ?? null,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
    vat: l.vat ?? 25,
  }));
}

const ArticleInvoiceOverridesSchema = z.object({
  customerNumber: z.string().max(50).nullable().optional(),
  customerName: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  zipCode: z.string().max(20).optional(),
  city: z.string().max(100).optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ourReference: z.string().max(50).optional(),
  yourReference: z.string().max(50).optional(),
  paymentTerms: z.string().max(10).optional(),
}).optional();

export const searchFortnoxCustomers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ query: z.string().max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const results = await searchCustomersFromCache(await getWorkshopId(context.userId), data.query);
    return { results };
  });

// Live (uncached) duplicate-name check, used right before showing the
// "customer already exists" warning so a Fortnox-side deletion is reflected
// immediately instead of waiting out the search cache's staleness window.
export const checkFortnoxCustomerExists = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ name: z.string().max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const workshopId = await getWorkshopId(context.userId);
    const lowerName = data.name.trim().toLowerCase();
    if (!lowerName) return { match: null };
    const results = await searchFortnoxCustomersLive(workshopId, data.name);
    const match = results.find((c) => c.name.trim().toLowerCase() === lowerName);
    return { match: match ?? null };
  });

export const searchArticles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ query: z.string().max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const results = await searchArticlesForUser(await getWorkshopId(context.userId), data.query);
    return { results };
  });

export const saveInvoiceArticles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ job_id: z.string().uuid(), articles: ArticleLinesSchema }).parse(d))
  .handler(async ({ data, context }) => {
    await saveInvoiceArticlesForJob(await getWorkshopId(context.userId), data.job_id, normalizeLines(data.articles));
    return { ok: true };
  });

export const previewFortnoxInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ job_id: z.string().uuid(), articles: ArticleLinesSchema, overrides: ArticleInvoiceOverridesSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const { invoiceId, invoice, pdfBase64 } = await previewFortnoxInvoiceForJob(
      await getWorkshopId(context.userId),
      data.job_id,
      normalizeLines(data.articles),
      data.overrides ?? {},
    );
    return { invoice_id: invoiceId, invoice, pdf_base64: pdfBase64 };
  });

// Opens a finished invoice: re-renders the PDF from the job's frozen snapshot
// (same pipeline as Förhandsgranska) and returns it exactly like the preview
// function does — base64 in the response, displayed by the same client code.
export const getFinalInvoicePdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const workshopId = await getWorkshopId(context.userId);
    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .select("*")
      .eq("id", data.job_id)
      .eq("workshop_id", workshopId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Jobbet hittades inte.");
    const { invoiceId, pdfBase64 } = await resolveJobInvoicePdf(job);
    return { invoice_id: invoiceId, pdf_base64: pdfBase64 };
  });

export const finalizeFortnoxInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      job_id: z.string().uuid(),
      articles: ArticleLinesSchema,
      action: z.enum(["book", "send", "book_send"]),
      overrides: ArticleInvoiceOverridesSchema,
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    return finalizeFortnoxInvoiceForJob(
      await getWorkshopId(context.userId),
      data.job_id,
      normalizeLines(data.articles),
      data.action,
      data.overrides ?? {},
    );
  });

export const createFortnoxArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      articleNumber: z.string().max(80).optional(),
      description: z.string().min(1).max(200),
      salesPrice: z.number().min(0).max(99999999).optional(),
      unit: z.string().max(10).optional(),
      vat: z.number().min(0).max(100).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    return createFortnoxArticleFn(await getWorkshopId(context.userId), data);
  });

export const createFortnoxCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      name: z.string().min(1).max(200),
      email: z.string().email().max(160).optional().or(z.literal("")),
      phone: z.string().max(40).optional(),
      orgNumber: z.string().max(40).optional(),
      address: z.string().max(500).optional(),
      zipCode: z.string().max(20).optional(),
      city: z.string().max(100).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    return createFortnoxCustomerDirectFn(await getWorkshopId(context.userId), data);
  });

export const bookkeepFortnoxInvoiceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ job_id: z.string().uuid(), invoice_id: z.string().min(1).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    await bookkeepInvoiceForJob(await getWorkshopId(context.userId), data.job_id, data.invoice_id);
    return { ok: true };
  });

export const updateFortnoxCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      customerNumber: z.string().min(1),
      name: z.string().max(200).optional(),
      phone: z.string().max(40).optional(),
      email: z.string().max(160).optional(),
      orgNumber: z.string().max(40).optional(),
      address: z.string().max(500).optional(),
      zipCode: z.string().max(20).optional(),
      city: z.string().max(100).optional(),
      termsOfPayment: z.string().max(10).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { customerNumber, ...updates } = data;
    await updateFortnoxCustomerDirectFn(await getWorkshopId(context.userId), customerNumber, updates);
    return { ok: true };
  });

export const updateFortnoxArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      currentArticleNumber: z.string().min(1).max(80),
      articleNumber: z.string().max(80).optional(),
      description: z.string().max(200).optional(),
      salesPrice: z.number().min(0).max(99999999).optional(),
      unit: z.string().max(10).optional(),
      vat: z.number().min(0).max(100).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { currentArticleNumber, ...updates } = data;
    return updateFortnoxArticleFn(await getWorkshopId(context.userId), currentArticleNumber, updates);
  });

export const deleteFortnoxArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ articleNumber: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    await deleteFortnoxArticleFn(await getWorkshopId(context.userId), data.articleNumber);
    return { ok: true };
  });

export const cancelPreviewFortnoxInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ job_id: z.string().uuid(), invoice_id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await cancelPreviewInvoiceFn(await getWorkshopId(context.userId), data.job_id, data.invoice_id);
    return { ok: true };
  });

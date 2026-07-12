import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { signJobAttachmentUrls } from "./customer.server";
import { getWorkshopId } from "./profile.server";
import { listCachedCustomers } from "./fortnox.server";

const PUBLISHED_CUSTOMER_URL = "https://sipomax.se";

function getCustomerBaseUrl(origin?: string | null): string {
  // Customer-facing links must use the published URL, never the Lovable
  // preview/sandbox origin (which puts a Lovable auth wall in front of customers).
  const fallback = (process.env.CANONICAL_APP_URL ?? PUBLISHED_CUSTOMER_URL).replace(/\/$/, "");
  if (!origin) return fallback;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    // Block Lovable preview/sandbox hosts (id-preview--*.lovable.app, *.sandbox.lovable.dev, etc.)
    if (host.endsWith(".lovable.app") && host !== "sipomax.lovable.app") return fallback;
    if (host.endsWith(".lovable.dev")) return fallback;
    if (host.endsWith(".lovableproject.com")) return fallback;
    return url.origin.replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

async function assertWorkshopUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "workshop")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have workshop access");
}

// Verify that a job belongs to the requesting user's workshop. Call this before
// reading or modifying any sub-resource (status updates, messages, etc.).
async function assertJobOwner(userId: string, jobId: string): Promise<void> {
  const workshopId = await getWorkshopId(userId);
  const { data, error } = await supabaseAdmin
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .eq("workshop_id", workshopId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Job not found");
}

export async function listWorkshopJobs(userId: string) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const { data, error } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("workshop_id", workshopId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getWorkshopInsights(userId: string) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);

  // Phase 1: fetch jobs (scoped to workshop) and profile in parallel.
  const [{ data: jobs, error: jobsErr }, { data: prof }] = await Promise.all([
    supabaseAdmin.from("jobs").select("*").eq("workshop_id", workshopId),
    supabaseAdmin.from("profiles").select("insights_last_seen_at").eq("id", userId).maybeSingle(),
  ]);
  if (jobsErr) throw new Error(jobsErr.message);

  const jobIds = (jobs ?? []).map((j) => j.id);

  // Phase 2: fetch sub-resources scoped to this workshop's jobs / records.
  const [{ data: updates, error: upErr }, { data: pendingOpps, error: oppErr }, { data: pendingCamps, error: campErr }] = await Promise.all([
    jobIds.length
      ? supabaseAdmin.from("status_updates").select("status,requires_approval,approval_state,quote_amount,created_at,job_id").in("job_id", jobIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    supabaseAdmin.from("opportunities").select("id,title,customer_name,opportunity_type,suggested_send_at,created_at,status").eq("workshop_id", workshopId).eq("status", "pending").order("created_at", { ascending: false }),
    supabaseAdmin.from("campaigns").select("id,title,campaign_type,recipients,suggested_send_at,created_at,status").eq("workshop_id", workshopId).eq("status", "pending").order("created_at", { ascending: false }),
  ]);
  if (upErr) throw new Error(upErr.message);
  if (oppErr) throw new Error(oppErr.message);
  if (campErr) throw new Error(campErr.message);
  const since = prof?.insights_last_seen_at ?? new Date(0).toISOString();
  const sinceMs = new Date(since).getTime();
  const newOpportunities = (pendingOpps ?? []).filter((o) => new Date(o.created_at).getTime() > sinceMs).length;
  const newCampaigns = (pendingCamps ?? []).filter((c) => new Date(c.created_at).getTime() > sinceMs).length;

  const allJobs = jobs ?? [];
  const allUpdates = updates ?? [];

  const active = allJobs.filter((j) => !j.archived_at);
  const archived = allJobs.filter((j) => j.archived_at);

  // Status distribution (active jobs)
  const statusCounts: Record<string, number> = {};
  for (const j of active) statusCounts[j.current_status] = (statusCounts[j.current_status] ?? 0) + 1;

  // Turnaround time (days) for archived jobs
  const durations: number[] = [];
  for (const j of archived) {
    if (!j.archived_at) continue;
    const ms = new Date(j.archived_at).getTime() - new Date(j.created_at).getTime();
    if (ms > 0) durations.push(ms / 86400000);
  }
  const avgTurnaround = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  // Jobs per day (last 30 days)
  const now = new Date();
  const days: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({ date: d.toISOString().slice(0, 10), count: 0 });
  }
  const dayIndex = new Map(days.map((d, i) => [d.date, i]));
  for (const j of allJobs) {
    const key = new Date(j.created_at).toISOString().slice(0, 10);
    const idx = dayIndex.get(key);
    if (idx !== undefined) days[idx].count++;
  }

  // Busiest weekday
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const j of allJobs) weekdayCounts[new Date(j.created_at).getDay()]++;

  // Customers
  const custMap = new Map<string, { name: string; count: number }>();
  for (const j of allJobs) {
    const phone = (j.customer_phone ?? "").replace(/[\s-]/g, "");
    const key = phone ? `p:${phone}` : `n:${(j.customer_name ?? "").trim().toLowerCase()}`;
    if (key === "n:") continue;
    const ex = custMap.get(key);
    if (ex) ex.count++;
    else custMap.set(key, { name: j.customer_name ?? "Okänd", count: 1 });
  }
  const totalCustomers = custMap.size;
  const repeatCustomers = Array.from(custMap.values()).filter((c) => c.count > 1).length;
  const topCustomers = Array.from(custMap.values()).sort((a, b) => b.count - a.count).slice(0, 5);

  // Vehicle makes
  const makeMap = new Map<string, number>();
  for (const j of allJobs) {
    const m = (j.vehicle_make ?? "").trim();
    if (!m) continue;
    makeMap.set(m, (makeMap.get(m) ?? 0) + 1);
  }
  const topMakes = Array.from(makeMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Quote stats
  const quotes = allUpdates.filter((u) => u.requires_approval);
  const approved = quotes.filter((u) => u.approval_state === "approved").length;
  const rejected = quotes.filter((u) => u.approval_state === "rejected").length;
  const pendingApproval = quotes.filter((u) => !u.approval_state || u.approval_state === "pending").length;
  const quoteAmounts = quotes.map((u) => Number(u.quote_amount ?? 0)).filter((n) => n > 0);
  const totalQuoted = quoteAmounts.reduce((a, b) => a + b, 0);
  const approvedAmounts = quotes
    .filter((u) => u.approval_state === "approved")
    .map((u) => Number(u.quote_amount ?? 0))
    .filter((n) => n > 0);
  const approvedValue = approvedAmounts.reduce((a, b) => a + b, 0);
  const avgQuote = quoteAmounts.length ? totalQuoted / quoteAmounts.length : 0;

  // Invoice stats
  const invoicesGenerated = allJobs.filter((j) => j.invoice_generated_at).length;
  const invoicesScheduled = allJobs.filter((j) => j.invoice_scheduled_at && !j.invoice_generated_at).length;
  const invoiceErrors = allJobs.filter((j) => j.invoice_error).length;

  // Operational alerts
  const awaitingPickup = active.filter((j) => j.current_status === "job_done").length;
  const awaitingApproval = active.filter((j) => j.current_status === "quote_sent").length;
  const inProgress = active.filter((j) =>
    ["started_work", "in_progress", "diagnosis_started", "quote_approved"].includes(j.current_status),
  ).length;

  // Mileage
  const mileages = allJobs.map((j) => j.mileage).filter((m): m is number => typeof m === "number" && m > 0);
  const avgMileage = mileages.length ? mileages.reduce((a, b) => a + b, 0) / mileages.length : 0;

  // Recent throughput
  const last7 = days.slice(-7).reduce((a, d) => a + d.count, 0);
  const prev7 = days.slice(-14, -7).reduce((a, d) => a + d.count, 0);
  const weekDelta = prev7 === 0 ? (last7 > 0 ? 100 : 0) : ((last7 - prev7) / prev7) * 100;

  return {
    totals: {
      active: active.length,
      archived: archived.length,
      total: allJobs.length,
      totalCustomers,
      repeatCustomers,
      repeatRate: totalCustomers ? (repeatCustomers / totalCustomers) * 100 : 0,
      avgTurnaround,
      avgMileage,
      last7,
      weekDelta,
    },
    statusCounts,
    daily: days,
    weekday: weekdayCounts,
    topCustomers,
    topMakes,
    quotes: {
      total: quotes.length,
      approved,
      rejected,
      pending: pendingApproval,
      approvalRate: quotes.length ? (approved / quotes.length) * 100 : 0,
      totalQuoted,
      approvedValue,
      avgQuote,
    },
    invoices: {
      generated: invoicesGenerated,
      scheduled: invoicesScheduled,
      errors: invoiceErrors,
    },
    alerts: {
      awaitingPickup,
      awaitingApproval,
      inProgress,
    },
    newCounts: {
      opportunities: newOpportunities,
      campaigns: newCampaigns,
    },
    rawData: {
      jobs: allJobs.map((j) => ({
        id: j.id,
        registration_number: j.registration_number,
        customer_name: j.customer_name,
        vehicle_make: j.vehicle_make,
        vehicle_model: j.vehicle_model,
        current_status: j.current_status,
        mileage: j.mileage,
        created_at: j.created_at,
        archived_at: j.archived_at,
        invoice_generated_at: j.invoice_generated_at,
        invoice_scheduled_at: j.invoice_scheduled_at,
      })),
      quotes: quotes.map((u) => ({
        job_id: u.job_id,
        quote_amount: Number(u.quote_amount ?? 0),
        approval_state: u.approval_state ?? "pending",
        created_at: u.created_at,
      })),
      pendingOpportunities: pendingOpps ?? [],
      pendingCampaigns: pendingCamps ?? [],
    },
  };
}

export async function listArchivedWorkshopJobs(userId: string) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const { data, error } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("workshop_id", workshopId)
    .not("archived_at", "is", null)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// A job counts as "done" once the work is finished — ready for pickup, picked
// up, or invoiced. The Kunder page is a record of completed customers, so only
// these jobs put a customer on the page.
function isJobDone(j: any): boolean {
  return (
    j.current_status === "job_done" ||
    j.current_status === "car_picked_up" ||
    !!j.archived_at ||
    !!j.fortnox_invoice_id ||
    !!j.invoice_generated_at ||
    !!j.invoice_booked_at
  );
}

// Once a job's invoice has been sent to the customer, its customer/contact/
// billing details are final and can't be edited — those are exactly what the
// customer was invoiced for. "Sent" is an "invoice_sent" status-update row (the
// same marker the invoice double-send guard relies on). Guards the edit
// endpoints so a sent invoice's job stays exactly as it was.
async function assertJobEditable(jobId: string, workshopId: string): Promise<void> {
  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .eq("workshop_id", workshopId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Job not found");
  const { data: sent } = await supabaseAdmin
    .from("status_updates")
    .select("id")
    .eq("job_id", jobId)
    .eq("status", "invoice_sent" as any)
    .limit(1)
    .maybeSingle();
  if (sent) {
    throw new Error("Fakturan är skickad till kunden – uppgifterna är låsta och kan inte längre ändras.");
  }
}

export async function listWorkshopCustomers(userId: string) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  // Jobs carry a frozen snapshot of the customer as they were at the time; the
  // Fortnox customer cache carries who the customer is NOW. The Kunder page
  // shows the current details (from the cache) while listing each job's own
  // historical snapshot underneath.
  const [{ data, error }, cachedCustomers] = await Promise.all([
    supabaseAdmin
      .from("jobs")
      .select("*")
      .eq("workshop_id", workshopId)
      .order("updated_at", { ascending: false }),
    listCachedCustomers(workshopId).catch((e) => {
      console.error("customer cache load failed", e);
      return [] as Awaited<ReturnType<typeof listCachedCustomers>>;
    }),
  ]);
  if (error) throw new Error(error.message);
  const cacheByNum = new Map(cachedCustomers.map((c) => [c.customerNumber, c]));
  const map = new Map<string, {
    key: string;
    fortnox_customer_number: string;
    customer_name: string;
    customer_company_name: string | null;
    customer_phone: string | null;
    customer_email: string | null;
    customer_org_number: string | null;
    billing_address: string | null;
    billing_postal_code: string | null;
    billing_city: string | null;
    jobs: typeof data;
  }>();
  for (const job of data ?? []) {
    // The customer number is the sole identity of a customer — a job is created
    // by picking a specific Fortnox customer, so it always has one. Jobs without
    // a number (e.g. legacy data) simply can't be attributed to a customer here.
    const num = ((job as any).fortnox_customer_number ?? "").trim();
    if (!num) continue;
    const existing = map.get(num);
    if (existing) {
      existing.jobs.push(job);
      // Fill missing details from older jobs
      existing.customer_company_name ??= (job as any).customer_company_name ?? null;
      existing.customer_email ??= job.customer_email;
      existing.customer_org_number ??= job.customer_org_number;
      existing.billing_address ??= job.billing_address;
      existing.billing_postal_code ??= job.billing_postal_code;
      existing.billing_city ??= job.billing_city;
    } else {
      map.set(num, {
        key: num,
        fortnox_customer_number: num,
        customer_name: job.customer_name ?? "",
        customer_company_name: (job as any).customer_company_name ?? null,
        customer_phone: job.customer_phone,
        customer_email: job.customer_email,
        customer_org_number: job.customer_org_number,
        billing_address: job.billing_address,
        billing_postal_code: job.billing_postal_code,
        billing_city: job.billing_city,
        jobs: [job],
      });
    }
  }
  return Array.from(map.values())
    // Overlay the current customer details from the Fortnox cache (falling back
    // to the snapshot for fields Fortnox doesn't have), then keep only the
    // customer's done jobs — the Kunder page lists completed work per customer.
    .map((c) => {
      const cur = cacheByNum.get(c.fortnox_customer_number);
      const header = cur
        ? {
            customer_name: cur.name || c.customer_name,
            customer_phone: cur.phone ?? c.customer_phone,
            customer_email: cur.email ?? c.customer_email,
            customer_org_number: cur.orgNumber ?? c.customer_org_number,
            billing_address: cur.address ?? c.billing_address,
            billing_postal_code: cur.zipCode ?? c.billing_postal_code,
            billing_city: cur.city ?? c.billing_city,
          }
        : {};
      return { ...c, ...header, jobs: (c.jobs ?? []).filter(isJobDone) };
    })
    .filter((c) => c.jobs.length > 0)
    .sort((a, b) => {
      // Sort by most recent job first
      const aLatest = a.jobs.length > 0 ? new Date(a.jobs[0].updated_at).getTime() : 0;
      const bLatest = b.jobs.length > 0 ? new Date(b.jobs[0].updated_at).getTime() : 0;
      return bLatest - aLatest;
    });
}

export async function getWorkshopJob(userId: string, id: string) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const [{ data: job, error: jobError }, { data: updates, error: updatesError }, { data: messages, error: messagesError }] = await Promise.all([
    supabaseAdmin.from("jobs").select("*").eq("id", id).eq("workshop_id", workshopId).maybeSingle(),
    supabaseAdmin.from("status_updates").select("*, status_update_attachments(*)").eq("job_id", id).order("created_at", { ascending: true }),
    supabaseAdmin.from("messages").select("*").eq("job_id", id).order("created_at", { ascending: true }),
  ]);

  if (jobError) throw new Error(jobError.message);
  if (!job) return { job: null, updates: [], messages: [] };
  if (updatesError) throw new Error(updatesError.message);
  if (messagesError) throw new Error(messagesError.message);
  const signedUpdates = await signJobAttachmentUrls(updates ?? []);
  return { job, updates: signedUpdates, messages: messages ?? [] };
}

export async function deleteWorkshopJob(userId: string, id: string) {
  await assertWorkshopUser(userId);
  await assertJobOwner(userId, id);

  // Get status update IDs to delete their attachments too
  const { data: updates, error: updatesErr } = await supabaseAdmin
    .from("status_updates")
    .select("id")
    .eq("job_id", id);
  if (updatesErr) throw new Error(updatesErr.message);

  const updateIds = (updates ?? []).map((u) => u.id);

  if (updateIds.length > 0) {
    const { error: attError } = await supabaseAdmin
      .from("status_update_attachments")
      .delete()
      .in("status_update_id", updateIds);
    if (attError) throw new Error(attError.message);
  }

  const { error: statusError } = await supabaseAdmin.from("status_updates").delete().eq("job_id", id);
  if (statusError) throw new Error(statusError.message);

  const { error: msgError } = await supabaseAdmin.from("messages").delete().eq("job_id", id);
  if (msgError) throw new Error(msgError.message);

  const { error: jobError } = await supabaseAdmin.from("jobs").delete().eq("id", id);
  if (jobError) throw new Error(jobError.message);

  return { deleted: true };
}


export async function updateWorkshopJobBilling(
  userId: string,
  jobId: string,
  data: {
    customer_first_name?: string;
    customer_last_name?: string;
    customer_company_name?: string;
    customer_name?: string;
    customer_phone?: string;
    customer_email?: string;
    customer_org_number?: string;
    billing_address?: string;
    billing_postal_code?: string;
    billing_city?: string;
  },
) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  await assertJobEditable(jobId, workshopId);
  // Partial-safe: a caller that doesn't submit the company-name field (e.g. a
  // billing form without one) must not erase an existing company name. Only
  // touch company/name when we were actually given the pieces to recompute them.
  const hasCompanyField = data.customer_company_name !== undefined;
  const companyName = data.customer_company_name?.trim() || "";
  const computedName = companyName || [data.customer_first_name?.trim(), data.customer_last_name?.trim()].filter(Boolean).join(" ") || data.customer_name?.trim() || "";
  const patch: Record<string, any> = {
    customer_email: data.customer_email?.trim() || null,
    customer_org_number: data.customer_org_number?.trim() || null,
    billing_address: data.billing_address?.trim() || null,
    billing_postal_code: data.billing_postal_code?.trim() || null,
    billing_city: data.billing_city?.trim() || null,
  };
  // Phone is this job's SMS target; update it here so editing the customer on
  // the job persists to this job's own snapshot (siblings stay untouched).
  if (data.customer_phone !== undefined) patch.customer_phone = data.customer_phone?.trim() || null;
  if (data.customer_first_name !== undefined) patch.customer_first_name = data.customer_first_name?.trim() || null;
  if (data.customer_last_name !== undefined) patch.customer_last_name = data.customer_last_name?.trim() || null;
  if (hasCompanyField) patch.customer_company_name = companyName || null;
  // customer_name is derived from the identity fields — only recompute it when
  // at least one identity field was provided, so a pure address edit leaves it.
  if (hasCompanyField || data.customer_first_name !== undefined || data.customer_last_name !== undefined || data.customer_name !== undefined) {
    patch.customer_name = computedName;
  }
  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .update(patch as any)
    .eq("id", jobId)
    .eq("workshop_id", workshopId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return job;
}

export async function updateWorkshopJobNotes(
  userId: string,
  jobId: string,
  notes: string,
) {
  await assertWorkshopUser(userId);
  // Scope by workshop so one workshop can never edit another workshop's job.
  const workshopId = await getWorkshopId(userId);
  await assertJobEditable(jobId, workshopId);
  const { error } = await supabaseAdmin
    .from("jobs")
    .update({ notes: notes.trim() || null })
    .eq("id", jobId)
    .eq("workshop_id", workshopId);
  if (error) throw new Error(error.message);
}

export async function patchWorkshopJobPhone(userId: string, jobId: string, phone: string) {
  await assertWorkshopUser(userId);
  // Scope by workshop. customer_phone is both the SMS target and the customer
  // portal's login credential, so an unscoped update here would let one
  // workshop redirect another workshop's SMS and hijack its portal access.
  const workshopId = await getWorkshopId(userId);
  await assertJobEditable(jobId, workshopId);
  const { error } = await supabaseAdmin
    .from("jobs")
    .update({ customer_phone: phone.trim() || null })
    .eq("id", jobId)
    .eq("workshop_id", workshopId);
  if (error) throw new Error(error.message);
}

export async function createWorkshopJob(
  userId: string,
  data: {
    registration_number: string;
    customer_first_name?: string | null;
    customer_last_name?: string | null;
    customer_company_name?: string | null;
    customer_name?: string | null;
    fortnox_customer_number?: string | null;
    customer_phone?: string | null;
    customer_email?: string | null;
    customer_org_number?: string | null;
    billing_address?: string | null;
    billing_postal_code?: string | null;
    billing_city?: string | null;
    vehicle_make?: string | null;
    vehicle_model?: string | null;
    vehicle_color?: string | null;
    vehicle_type?: string | null;
    vehicle_status?: string | null;
    owner_count?: number | null;
    last_inspection_date?: string | null;
    next_inspection_date?: string | null;
    mileage?: number | null;
    notes?: string | null;
    initial_price?: number | null;
    mileage_recorded_at?: string | null;
    mileage_source?: string | null;
    mileage_at_last_service?: number | null;
    last_service_at?: string | null;
    avg_km_per_month?: number | null;
    engine_type?: string | null;
    engine_code?: string | null;
    gearbox_type?: string | null;
    vin?: string | null;
    model_year?: number | null;
    recommended_service_interval_km?: number | null;
    recommended_service_interval_months?: number | null;
    identifier_type?: "registration" | "article";
  },
) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);
  const identifierType = data.identifier_type ?? "registration";
  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .insert({
      identifier_type: identifierType,
      registration_number: identifierType === "article"
        ? data.registration_number.trim()
        : data.registration_number.toUpperCase().trim(),
      customer_first_name: data.customer_first_name?.trim() || null,
      customer_last_name: data.customer_last_name?.trim() || null,
      customer_company_name: data.customer_company_name?.trim() || null,
      customer_name: data.customer_company_name?.trim() || [data.customer_first_name?.trim(), data.customer_last_name?.trim()].filter(Boolean).join(" ") || data.customer_name?.trim() || "",
      fortnox_customer_number: data.fortnox_customer_number?.trim() || null,
      customer_phone: data.customer_phone ?? null,
      customer_email: data.customer_email || null,
      customer_org_number: data.customer_org_number || null,
      billing_address: data.billing_address || null,
      billing_postal_code: data.billing_postal_code || null,
      billing_city: data.billing_city || null,
      vehicle_make: data.vehicle_make ?? null,
      vehicle_model: data.vehicle_model ?? null,
      vehicle_color: data.vehicle_color ?? null,
      vehicle_type: data.vehicle_type ?? null,
      vehicle_status: data.vehicle_status ?? null,
      owner_count: data.owner_count ?? null,
      last_inspection_date: data.last_inspection_date ?? null,
      next_inspection_date: data.next_inspection_date ?? null,
      mileage: data.mileage ?? null,
      notes: data.notes ?? null,
      initial_price: data.initial_price ?? null,
      mileage_recorded_at: data.mileage_recorded_at ?? (data.mileage != null ? new Date().toISOString() : null),
      mileage_source: data.mileage_source ?? (data.mileage != null ? "manual_entry" : null),
      mileage_at_last_service: data.mileage_at_last_service ?? null,
      last_service_at: data.last_service_at ?? null,
      avg_km_per_month: data.avg_km_per_month ?? null,
      engine_type: data.engine_type ?? null,
      engine_code: data.engine_code ?? null,
      gearbox_type: data.gearbox_type ?? null,
      vin: data.vin ?? null,
      model_year: data.model_year ?? null,
      recommended_service_interval_km: data.recommended_service_interval_km ?? null,
      recommended_service_interval_months: data.recommended_service_interval_months ?? null,
      created_by: userId,
      workshop_id: workshopId,
    } as any)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  const { error: statusError } = await supabaseAdmin.from("status_updates").insert({
    job_id: job.id,
    status: "order_received" as any,
    description: null,
    created_by: userId,
  });
  if (statusError) throw new Error(statusError.message);

  await supabaseAdmin
    .from("jobs")
    .update({ current_status: "order_received" as any })
    .eq("id", job.id);

  return job;
}

export async function addWorkshopStatusUpdate(
  userId: string,
  data: {
    job_id: string;
    status: "car_dropped_off" | "diagnosis_started" | "started_work" | "quote_sent" | "quote_approved" | "quote_rejected" | "in_progress" | "job_done" | "car_picked_up";
    description?: string | null;
    quote_amount?: number | null;
    approval_state?: "pending" | "approved" | "rejected" | null;
    articles?: Array<{
      article_number?: string | null;
      description: string;
      quantity: number;
      unit_price: number;
      vat?: number | null;
    }> | null;
    attachments?: Array<{ file_path: string; file_name: string; mime_type?: string | null }>;
    origin?: string | null;
  },
) {
  await assertWorkshopUser(userId);
  await assertJobOwner(userId, data.job_id);

  const { data: jobRow, error: jobFetchError } = await supabaseAdmin
    .from("jobs")
    .select("customer_phone, fortnox_invoice_id, visma_invoice_id, invoice_generated_at, invoice_booked_at")
    .eq("id", data.job_id)
    .maybeSingle();
  if (jobFetchError) throw new Error(jobFetchError.message);

  const requiresApproval = data.status === "quote_sent";
  const isApprovedQuote = requiresApproval && data.approval_state === "approved";
  // Status updates are how the customer is notified (SMS) — without a phone
  // number on file there's nowhere to send it, so require one up front.
  // Exception: a workshop-side pre-approved quote never triggers an SMS
  // (the customer didn't take the approval action), so no phone is needed.
  if (!isApprovedQuote && !(jobRow as any)?.customer_phone?.trim()) {
    throw new Error("Lägg till kundens telefonnummer innan du publicerar uppdateringen.");
  }

  if (requiresApproval) {
    if (!data.articles?.length) {
      throw new Error("En offert måste innehålla minst en artikel.");
    }
    // A job that already has an invoice can't receive a new offer — the
    // customer has already been billed, and the Fakturering tab's article
    // lines are frozen to what was actually invoiced.
    const hasInvoice = !!(
      (jobRow as any)?.fortnox_invoice_id ||
      (jobRow as any)?.visma_invoice_id ||
      (jobRow as any)?.invoice_generated_at ||
      (jobRow as any)?.invoice_booked_at
    );
    if (hasInvoice) {
      throw new Error("En faktura har redan skapats för det här jobbet. Nya offerter kan inte skickas.");
    }
  }
  const allowsQuoteAmount = requiresApproval || data.status === "started_work";
  // Article lines are only meaningful on offers (quote_sent).
  const articles = requiresApproval && data.articles?.length ? data.articles : null;
  const insertRow: Record<string, any> = {
    job_id: data.job_id,
    status: isApprovedQuote ? "quote_approved" : data.status,
    description: data.description ?? null,
    quote_amount: allowsQuoteAmount ? (data.quote_amount ?? null) : null,
    articles,
    requires_approval: requiresApproval && !isApprovedQuote,
    approval_state: requiresApproval ? (data.approval_state ?? "pending") : null,
    created_by: userId,
  };
  const { data: update, error } = await supabaseAdmin
    .from("status_updates")
    .insert(insertRow as any)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  if (data.attachments?.length) {
    const { error: attachmentError } = await supabaseAdmin.from("status_update_attachments").insert(
      data.attachments.map((attachment) => ({
        status_update_id: update.id,
        file_path: attachment.file_path,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type ?? null,
      })),
    );
    if (attachmentError) throw new Error(attachmentError.message);
  }

  const isPickup = data.status === "car_picked_up";
  const { error: jobError } = await supabaseAdmin
    .from("jobs")
    .update({
      current_status: isApprovedQuote ? "quote_approved" : (requiresApproval ? "quote_sent" : data.status),
      updated_at: new Date().toISOString(),
      ...(isPickup ? { archived_at: new Date().toISOString() } : {}),
    })
    .eq("id", data.job_id);
  if (jobError) throw new Error(jobError.message);

  if (isPickup) {
    try {
      await sendPickupThanksSms(userId, data.job_id);
    } catch (e) {
      console.error("Pickup SMS failed:", e);
    }
  } else if (!isApprovedQuote) {
    // Skip SMS when workshop pre-approves a quote on behalf of the customer —
    // no notification should go out since the customer didn't take the action.
    try {
      await sendStatusUpdateSms(data.job_id, data.status, data.origin ?? null);
    } catch (e) {
      console.error("Status update SMS failed:", e);
    }
  }

  return update;
}

function normalizePhone(raw: string): string {
  const p = raw.replace(/[\s-]/g, "");
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return `+${p.slice(2)}`;
  if (p.startsWith("0")) return `+46${p.slice(1)}`;
  return `+${p}`;
}

type WelcomeLinkJob = {
  id: string;
  customer_name: string | null;
  customer_first_name: string | null;
  customer_company_name?: string | null;
  customer_phone: string | null;
  job_token: string;
};

// First name for SMS greetings ("Hej X!"). The explicit first-name field is
// trusted for company customers — there it holds the contact person, who is
// not part of the company name. For private customers it must still match the
// job's current customer_name: a first name left behind by an earlier linked
// customer (e.g. "Byt kund" in the invoice tab only repoints
// fortnox_customer_number, and partial updates can rewrite customer_name
// alone) must never greet the wrong person. When they disagree, the visible
// customer_name wins.
function smsFirstName(job: {
  customer_first_name?: string | null;
  customer_company_name?: string | null;
  customer_name?: string | null;
}): string {
  const first = (job.customer_first_name ?? "").trim();
  const name = (job.customer_name ?? "").trim();
  if (first) {
    if ((job.customer_company_name ?? "").trim()) return first;
    if (name.toLowerCase().includes(first.toLowerCase())) return first;
  }
  return name.split(/\s+/)[0] || "";
}

// Sends the introductory "here is your link / how to log in" SMS and stamps
// link_sms_sent_at so it's only ever sent once per job. This is the message
// every customer must receive first, before any status/quote/chat SMS.
async function deliverWelcomeLinkSms(job: WelcomeLinkJob, origin: string | null) {
  if (!job.customer_phone) return { ok: false as const, reason: "no_phone" };
  const username = process.env.ELKS_API_USERNAME?.trim();
  const password = process.env.ELKS_API_PASSWORD?.trim();
  const sender = process.env.ELKS_SENDER?.trim();
  if (!username || !password || !sender) {
    throw new Error("46elks credentials are not configured");
  }

  const link = `${getCustomerBaseUrl(origin)}/c/${job.job_token}`;
  const firstName = smsFirstName(job);
  const greeting = firstName ? `Hej ${firstName}! ` : "Hej! ";
  const message = `${greeting}Ditt ärende hanteras nu av oss. Följ status och chatta med oss här: ${link}\n\nLogga in med ditt telefonnummer.`;

  const body = new URLSearchParams({ from: sender, to: normalizePhone(job.customer_phone), message });
  const auth = btoa(`${username}:${password}`);
  const res = await fetch("https://api.46elks.com/a1/sms", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("46elks rejected the API username/password. Re-enter the API Username and API Password exactly as shown in 46elks, without labels or extra spaces.");
    }
    throw new Error(`46elks error [${res.status}]: ${text}`);
  }
  await supabaseAdmin
    .from("jobs")
    .update({ link_sms_sent_at: new Date().toISOString() } as any)
    .eq("id", job.id);
  return { ok: true as const, response: text };
}

// Guarantees the welcome link SMS has gone out before any other SMS. If the
// workshop skipped adding a phone number up front and only added it when
// sending, say, a quote, this sends the intro message first so the customer
// still gets the link + login instructions ahead of the quote SMS.
async function ensureWelcomeLinkSmsSent(jobId: string, origin: string | null) {
  const { data: job } = (await supabaseAdmin
    .from("jobs")
    .select("id, customer_name, customer_first_name, customer_company_name, customer_phone, job_token, link_sms_sent_at")
    .eq("id", jobId)
    .maybeSingle()) as any;
  if (!job?.customer_phone) return;
  if (job.link_sms_sent_at) return;
  await deliverWelcomeLinkSms(job, origin);
}

const STATUS_SMS_LABEL_SV: Record<string, string> = {
  car_dropped_off: "Bil inlämnad",
  diagnosis_started: "Felsökning påbörjad",
  started_work: "Arbete påbörjat",
  quote_sent: "Offert skickad – väntar på ditt godkännande",
  quote_approved: "Offert godkänd",
  quote_rejected: "Offert avvisad",
  in_progress: "Pågående arbete",
  job_done: "Jobbet klart – bilen redo att hämtas",
  invoice_sent: "Din faktura är klar",
};

export async function sendStatusUpdateSms(jobId: string, status: string, origin: string | null) {
  const { data: job, error } = (await supabaseAdmin
    .from("jobs")
    .select("id, customer_name, customer_first_name, customer_company_name, customer_phone, registration_number, job_token")
    .eq("id", jobId)
    .single()) as any;
  if (error) throw new Error(error.message);
  if (!job.customer_phone) return { ok: false as const, reason: "no_phone" };

  // The intro link/login SMS must always be the customer's first message —
  // send it first if it hasn't gone out yet (e.g. the number was only added
  // now, when publishing this update), then continue with the status SMS.
  try {
    await ensureWelcomeLinkSmsSent(job.id, origin);
  } catch (e) {
    console.error("welcome link SMS (before status update) failed", e);
  }

  const username = process.env.ELKS_API_USERNAME?.trim();
  const password = process.env.ELKS_API_PASSWORD?.trim();
  const sender = process.env.ELKS_SENDER?.trim();
  if (!username || !password || !sender) {
    throw new Error("46elks credentials are not configured");
  }

  const link = `${getCustomerBaseUrl(origin)}/c/${job.job_token}`;
  const firstName = smsFirstName(job);
  const label = STATUS_SMS_LABEL_SV[status] ?? "Ny statusuppdatering";
  const message = `Hej ${firstName}! Ny uppdatering: ${label}. Se detaljer och chatta med verkstaden här: ${link}`;

  const body = new URLSearchParams({ from: sender, to: normalizePhone(job.customer_phone), message });
  const auth = btoa(`${username}:${password}`);
  const res = await fetch("https://api.46elks.com/a1/sms", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`46elks error [${res.status}]: ${text}`);
  return { ok: true as const };
}

export async function sendPickupThanksSms(userId: string, jobId: string) {
  const workshopId = await getWorkshopId(userId);
  const { data: job, error } = (await supabaseAdmin
    .from("jobs")
    .select("id, customer_name, customer_first_name, customer_company_name, customer_phone, registration_number, workshop_id")
    .eq("id", jobId)
    .eq("workshop_id", workshopId)
    .single()) as any;
  if (error) throw new Error(error.message);
  if (!job.customer_phone) return { ok: false as const, reason: "no_phone" };

  const profileOwnerId = job.workshop_id ?? workshopId;
  let reviewUrl: string | null = null;
  let reviewEnabled = true;
  let reviewMessage: string | null = null;
  if (profileOwnerId) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("google_review_url, pickup_sms_review_enabled, pickup_sms_review_message")
      .eq("id", profileOwnerId)
      .maybeSingle();
    reviewUrl = profile?.google_review_url ?? null;
    reviewEnabled = (profile as any)?.pickup_sms_review_enabled ?? true;
    reviewMessage = (profile as any)?.pickup_sms_review_message ?? null;
  }

  const username = process.env.ELKS_API_USERNAME?.trim();
  const password = process.env.ELKS_API_PASSWORD?.trim();
  const sender = process.env.ELKS_SENDER?.trim();
  if (!username || !password || !sender) {
    throw new Error("46elks credentials are not configured");
  }

  const firstName = smsFirstName(job);
  const defaultReviewText =
    "Om du har en stund över skulle det betyda mycket för oss om du delade din upplevelse i en kort Google-recension:";
  const lines = [
    `Hej ${firstName}!`,
    `Tack för att du valde oss – det var trevligt att få ta hand om ditt ärende.`,
    ...(reviewEnabled && reviewUrl
      ? [`${reviewMessage?.trim() || defaultReviewText} ${reviewUrl}`]
      : []),
    `Tveka inte att höra av dig om något känns annorlunda med bilen.`,
  ];
  const message = lines.join("\n\n");

  const body = new URLSearchParams({ from: sender, to: normalizePhone(job.customer_phone), message });
  const auth = btoa(`${username}:${password}`);
  const res = await fetch("https://api.46elks.com/a1/sms", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`46elks error [${res.status}]: ${text}`);
  return { ok: true as const };
}

// Posts a workshop → customer chat message. This does ONLY the in-platform
// delivery (the DB insert), which is what the customer's job card reads via
// realtime, and returns immediately. The optional SMS heads-up to the
// customer is a slow, external side-effect (46elks) handled separately by
// notifyWorkshopChatSms so it never delays the message appearing on screen.
export async function sendWorkshopJobMessage(userId: string, data: { job_id: string; body: string }) {
  const [, workshopId] = await Promise.all([assertWorkshopUser(userId), getWorkshopId(userId)]);

  // Workshop-scoped select doubles as the ownership check.
  const { data: job, error: jobError } = await supabaseAdmin
    .from("jobs")
    .select("id")
    .eq("id", data.job_id)
    .eq("workshop_id", workshopId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Job not found");

  const { data: message, error } = await supabaseAdmin
    .from("messages")
    .insert({
      job_id: data.job_id,
      sender_type: "workshop",
      sender_id: userId,
      body: data.body,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return message;
}

// Throttled SMS heads-up telling the customer a new chat message is waiting.
// Fired separately from (and after) sendWorkshopJobMessage so its 46elks
// round-trips never block the message showing up in the app. Best-effort:
// any failure here leaves the delivered chat message untouched.
export async function notifyWorkshopChatSms(userId: string, data: { job_id: string }) {
  await assertWorkshopUser(userId);
  await assertJobOwner(userId, data.job_id);
  try {
    const { data: job } = (await supabaseAdmin
      .from("jobs")
      .select("customer_name, customer_first_name, customer_company_name, customer_phone, registration_number, job_token, last_chat_sms_at")
      .eq("id", data.job_id)
      .single()) as any;
    if (!job?.customer_phone) return { ok: false as const, reason: "no_phone" };

    const username = process.env.ELKS_API_USERNAME?.trim();
    const password = process.env.ELKS_API_PASSWORD?.trim();
    const sender = process.env.ELKS_SENDER?.trim();

    // Find the last customer message time
    const { data: lastCustMsg } = await supabaseAdmin
      .from("messages")
      .select("created_at")
      .eq("job_id", data.job_id)
      .eq("sender_type", "customer")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastCustomerAt = lastCustMsg?.created_at ?? null;
    // Send SMS immediately only if customer's last message was > 5 min ago (they've probably left the app).
    // If < 5 min ago, they're likely still in the app — the pending reminder will catch them if they leave.
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const shouldSendNow = !lastCustomerAt || lastCustomerAt < fiveMinAgo;

    const reminderAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await supabaseAdmin.from("jobs").update({ pending_chat_reminder_at: reminderAt } as any).eq("id", data.job_id);

    if (shouldSendNow && username && password && sender) {
      // Ensure the intro link/login SMS is the customer's first message,
      // even when the workshop's opening contact is a chat message.
      try {
        await ensureWelcomeLinkSmsSent(data.job_id, null);
      } catch (e) {
        console.error("welcome link SMS (before chat) failed", e);
      }
      const link = `${getCustomerBaseUrl(null)}/c/${job.job_token}`;
      const firstName = smsFirstName(job);
      const greeting = firstName ? `Hej ${firstName}! ` : "";
      const smsBody = `${greeting}Nytt meddelande från verkstaden. Svara här: ${link}`;
      const body = new URLSearchParams({ from: sender, to: normalizePhone(job.customer_phone), message: smsBody });
      const auth = btoa(`${username}:${password}`);
      const res = await fetch("https://api.46elks.com/a1/sms", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (res.ok) {
        await supabaseAdmin.from("jobs").update({ last_chat_sms_at: new Date().toISOString() } as any).eq("id", data.job_id);
      } else {
        const txt = await res.text();
        console.error("workshop chat SMS failed", res.status, txt);
      }
    }
    return { ok: true as const };
  } catch (e) {
    console.error("workshop chat SMS error", e);
    return { ok: false as const, reason: "error" };
  }
}

export async function sendCustomerSmsLinkServer(
  userId: string,
  data: { job_id: string; origin: string },
) {
  await assertWorkshopUser(userId);
  const workshopId = await getWorkshopId(userId);

  const { data: job, error } = (await supabaseAdmin
    .from("jobs")
    .select("id, registration_number, customer_name, customer_first_name, customer_company_name, customer_phone, job_token")
    .eq("id", data.job_id)
    .eq("workshop_id", workshopId)
    .single()) as any;
  if (error) throw new Error(error.message);
  if (!job.customer_phone) throw new Error("This job has no customer phone number");

  // Shared with the auto "welcome first" path — also stamps link_sms_sent_at
  // so a later status/quote SMS won't re-send the intro message.
  const result = await deliverWelcomeLinkSms(job, data.origin);
  return { ok: true as const, response: (result as any).response ?? "" };
}

export async function runPendingChatReminders(): Promise<{ sent: number; skipped: number }> {
  const now = new Date().toISOString();
  const { data: jobs, error } = (await supabaseAdmin
    .from("jobs")
    .select("id, customer_name, customer_first_name, customer_company_name, customer_phone, registration_number, job_token, last_chat_sms_at, pending_chat_reminder_at")
    .lte("pending_chat_reminder_at" as any, now)
    .not("pending_chat_reminder_at" as any, "is", null)) as any;
  if (error) throw new Error(error.message);

  const username = process.env.ELKS_API_USERNAME?.trim();
  const password = process.env.ELKS_API_PASSWORD?.trim();
  const sender = process.env.ELKS_SENDER?.trim();

  let sent = 0;
  let skipped = 0;

  for (const job of jobs ?? []) {
    // Clear the pending reminder regardless of outcome
    await supabaseAdmin.from("jobs").update({ pending_chat_reminder_at: null } as any).eq("id", job.id);

    if (!job.customer_phone) { skipped++; continue; }

    // Check if customer replied since last SMS
    const { data: lastCustMsg } = await supabaseAdmin
      .from("messages")
      .select("created_at")
      .eq("job_id", job.id)
      .eq("sender_type", "customer")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastCustomerAt = lastCustMsg?.created_at ?? null;
    const lastSmsAt = (job as any).last_chat_sms_at ?? null;
    if (lastCustomerAt && lastSmsAt && lastCustomerAt > lastSmsAt) {
      // Customer replied since last SMS — no reminder needed
      skipped++;
      continue;
    }

    if (!username || !password || !sender) { skipped++; continue; }

    const link = `${getCustomerBaseUrl(null)}/c/${job.job_token}`;
    const firstName = smsFirstName(job);
    const greeting = firstName ? `Hej ${firstName}! ` : "";
    const message = `${greeting}Du har ett obesvarat meddelande från verkstaden. Svara här: ${link}`;
    const body = new URLSearchParams({ from: sender, to: normalizePhone(job.customer_phone), message });
    const auth = btoa(`${username}:${password}`);
    const res = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (res.ok) {
      await supabaseAdmin.from("jobs").update({ last_chat_sms_at: new Date().toISOString() } as any).eq("id", job.id);
      sent++;
    } else {
      console.error("chat reminder SMS failed", job.id, res.status);
      skipped++;
    }
  }
  return { sent, skipped };
}

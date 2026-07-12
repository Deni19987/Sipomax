import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  addWorkshopStatusUpdate,
  createWorkshopJob,
  getWorkshopJob,
  listWorkshopJobs,
  listArchivedWorkshopJobs,
  sendWorkshopJobMessage,
  notifyWorkshopChatSms,
  sendCustomerSmsLinkServer,
  updateWorkshopJobBilling,
  updateWorkshopJobNotes,
  patchWorkshopJobPhone,
  listWorkshopCustomers,
  deleteWorkshopJob,
  getWorkshopInsights,
} from "./jobs.server";

export const listJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const jobs = await listWorkshopJobs(context.userId);
    return { jobs };
  });

export const getInsights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return getWorkshopInsights(context.userId);
  });

export const listArchivedJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const jobs = await listArchivedWorkshopJobs(context.userId);
    return { jobs };
  });

export const listCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const customers = await listWorkshopCustomers(context.userId);
    return { customers };
  });

export const getJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    return getWorkshopJob(context.userId, data.id);
  });

export const createJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      registration_number: z.string().min(1).max(80),
      identifier_type: z.enum(["registration", "article"]).optional(),
      customer_first_name: z.string().max(60).optional().nullable().transform((v) => v ?? ""),
      customer_last_name: z.string().max(60).optional().nullable().transform((v) => v ?? ""),
      customer_company_name: z.string().max(120).optional().nullable().transform((v) => v ?? ""),
      customer_name: z.string().max(120).optional().nullable().transform((v) => v ?? ""),
      fortnox_customer_number: z.string().max(40).optional().nullable(),
      customer_phone: z.string().max(40).optional().nullable(),
      customer_email: z.string().email().max(160).optional().nullable().or(z.literal("")),
      customer_org_number: z.string().max(40).optional().nullable(),
      billing_address: z.string().max(200).optional().nullable(),
      billing_postal_code: z.string().max(20).optional().nullable(),
      billing_city: z.string().max(80).optional().nullable(),
      vehicle_make: z.string().max(60).optional().nullable(),
      vehicle_model: z.string().max(60).optional().nullable(),
      vehicle_color: z.string().max(40).optional().nullable(),
      vehicle_type: z.string().max(60).optional().nullable(),
      vehicle_status: z.string().max(60).optional().nullable(),
      owner_count: z.number().int().min(0).max(999).optional().nullable(),
      last_inspection_date: z.string().max(40).optional().nullable(),
      next_inspection_date: z.string().max(40).optional().nullable(),
      mileage: z.number().int().min(0).max(9999999).optional().nullable(),
      notes: z.string().max(2000).optional().nullable(),
      initial_price: z.number().min(0).max(99999999).optional().nullable(),
      mileage_recorded_at: z.string().datetime({ offset: true }).optional().nullable(),
      mileage_source: z.string().max(40).optional().nullable(),
      mileage_at_last_service: z.number().int().min(0).max(9999999).optional().nullable(),
      last_service_at: z.string().datetime({ offset: true }).optional().nullable(),
      avg_km_per_month: z.number().min(0).max(100000).optional().nullable(),
      engine_type: z.string().max(40).optional().nullable(),
      engine_code: z.string().max(60).optional().nullable(),
      gearbox_type: z.string().max(40).optional().nullable(),
      vin: z.string().max(40).optional().nullable(),
      model_year: z.number().int().min(1900).max(2100).optional().nullable(),
      recommended_service_interval_km: z.number().int().min(0).max(999999).optional().nullable(),
      recommended_service_interval_months: z.number().int().min(0).max(360).optional().nullable(),
      scheduled_start: z.string().datetime({ offset: true }).optional().nullable(),
      duration_minutes: z.number().int().min(5).max(24 * 60).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const job = await createWorkshopJob(context.userId, data);
    return { job };
  });

export const addStatusUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      job_id: z.string().uuid(),
      status: z.enum(["car_dropped_off", "diagnosis_started", "started_work", "quote_sent", "quote_approved", "quote_rejected", "in_progress", "job_done", "car_picked_up"]),
      description: z.string().max(2000).optional().nullable(),
      quote_amount: z.number().min(0).max(99999999).optional().nullable(),
      approval_state: z.enum(["pending", "approved", "rejected"]).optional().nullable(),
      articles: z
        .array(
          z.object({
            article_number: z.string().max(80).nullable().optional(),
            description: z.string().max(200),
            quantity: z.number().min(0).max(1000000),
            unit_price: z.number().min(0).max(99999999),
            vat: z.number().min(0).max(100).nullable().optional(),
          }),
        )
        .max(100)
        .optional()
        .nullable(),
      attachments: z.array(z.object({
        file_path: z.string(),
        file_name: z.string(),
        mime_type: z.string().optional().nullable(),
      })).optional(),
      origin: z.string().url().optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const update = await addWorkshopStatusUpdate(context.userId, data);
    return { update };
  });

export const sendWorkshopMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    job_id: z.string().uuid(),
    body: z.string().min(1).max(4000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const msg = await sendWorkshopJobMessage(context.userId, data);
    return { message: msg };
  });

// Fired-and-forgotten by the client after a chat message is sent — runs the
// throttled SMS heads-up to the customer without holding up the message
// delivery, which is purely in-app (realtime) and already done.
export const notifyWorkshopMessageSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    job_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    return notifyWorkshopChatSms(context.userId, data);
  });

export const sendCustomerSmsLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    job_id: z.string().uuid(),
    origin: z.string().url(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    return sendCustomerSmsLinkServer(context.userId, data);
  });

export const updateJobBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      job_id: z.string().uuid(),
      customer_first_name: z.string().max(60).optional().or(z.literal("")),
      customer_last_name: z.string().max(60).optional().or(z.literal("")),
      customer_company_name: z.string().max(120).optional().or(z.literal("")),
      customer_name: z.string().max(120).optional().or(z.literal("")),
      customer_phone: z.string().max(40).optional().or(z.literal("")),
      customer_email: z.string().email().max(160).optional().or(z.literal("")),
      customer_org_number: z.string().max(40).optional().or(z.literal("")),
      billing_address: z.string().max(200).optional().or(z.literal("")),
      billing_postal_code: z.string().max(20).optional().or(z.literal("")),
      billing_city: z.string().max(80).optional().or(z.literal("")),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { job_id, ...rest } = data;
    const job = await updateWorkshopJobBilling(context.userId, job_id, rest);
    return { job };
  });

export const updateJobNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      job_id: z.string().uuid(),
      notes: z.string().max(10000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await updateWorkshopJobNotes(context.userId, data.job_id, data.notes);
    return { ok: true };
  });

export const patchJobPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ job_id: z.string().uuid(), phone: z.string().max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    await patchWorkshopJobPhone(context.userId, data.job_id, data.phone);
    return { ok: true };
  });

export const deleteJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    return deleteWorkshopJob(context.userId, data.id);
  });


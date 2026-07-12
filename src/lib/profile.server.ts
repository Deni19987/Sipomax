import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Payment details shown in the invoice footer (stored as JSON on the profile).
export type InvoiceBankDetails = {
  bankgiro?: string | null;
  plusgiro?: string | null;
  iban?: string | null;
  clearingNumber?: string | null;
  accountNumber?: string | null;
  paymentNote?: string | null;
};

export type WorkshopProfile = {
  id: string;
  display_name: string | null;
  company_name: string | null;
  company_zip_code: string | null;
  company_city: string | null;
  company_org_number: string | null;
  company_vat_number: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  workshop_address: string | null;
  google_review_url: string | null;
  pickup_sms_enabled: boolean;
  pickup_sms_review_enabled: boolean;
  pickup_sms_review_message: string | null;
  sms_signature: string | null;
  opportunity_prompt_extra: string | null;
  service_prompt_extra: string | null;
  service_metrics: string[] | null;
  opportunity_prompt_base: string | null;
  service_prompt_base: string | null;
  notify_customer_messages: boolean;
  notify_quote_responses: boolean;
  notify_pending_reminders: boolean;
  notify_mobile_push: boolean;
  notify_desktop_push: boolean;
  invoice_bank_details: InvoiceBankDetails | null;
};

const PROFILE_COLUMNS =
  "id, display_name, company_name, company_zip_code, company_city, company_org_number, company_vat_number, contact_email, contact_phone, workshop_address, google_review_url, pickup_sms_enabled, pickup_sms_review_enabled, pickup_sms_review_message, sms_signature, opportunity_prompt_extra, service_prompt_extra, service_metrics, opportunity_prompt_base, service_prompt_base, notify_customer_messages, notify_quote_responses, notify_pending_reminders, notify_mobile_push, notify_desktop_push, invoice_bank_details";

// Admin-managed per-user feature flags, read separately from the main profile
// so a lagging migration never breaks the app — missing columns just fall back
// to "enabled".
export type UserFeatureFlags = {
  opportunities_enabled: boolean;
  campaigns_enabled: boolean;
};

export async function getUserFeatureFlags(userId: string): Promise<UserFeatureFlags> {
  // Feature flags are a workshop-level setting: every login in a workshop
  // sees the same enabled pages.
  const workshopId = await getWorkshopId(userId);
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("opportunities_enabled, campaigns_enabled")
    .eq("id", workshopId)
    .maybeSingle();
  if (error || !data) return { opportunities_enabled: true, campaigns_enabled: true };
  const row = data as unknown as Partial<UserFeatureFlags>;
  return {
    opportunities_enabled: row.opportunities_enabled ?? true,
    campaigns_enabled: row.campaigns_enabled ?? true,
  };
}

// Settings (company profile, SMS, notifications, AI prompts) are stored once
// per workshop, on the workshop owner's profile row. Reading/writing always
// resolves to the workshop so every team member login shares the same values.
export async function getWorkshopProfile(userId: string): Promise<WorkshopProfile> {
  const workshopId = await getWorkshopId(userId);
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", workshopId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { data: created, error: insertError } = await supabaseAdmin
      .from("profiles")
      .insert({ id: workshopId })
      .select(PROFILE_COLUMNS)
      .single();
    if (insertError) throw new Error(insertError.message);
    return created as unknown as WorkshopProfile;
  }
  return data as unknown as WorkshopProfile;
}

export async function updateWorkshopProfile(
  userId: string,
  patch: Partial<Omit<WorkshopProfile, "id">>,
): Promise<WorkshopProfile> {
  const workshopId = await getWorkshopId(userId);
  // Ensure row exists first
  await getWorkshopProfile(workshopId);
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update(patch as never)
    .eq("id", workshopId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as WorkshopProfile;
}

// Returns the auth email for a user. Used to gate developer-only UI.
export async function getUserAuthEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) throw new Error(error.message);
  return data.user?.email ?? null;
}

const DEVELOPER_EMAILS = new Set<string>(["hedisson@live.se"]);

export async function isDeveloperUser(userId: string): Promise<boolean> {
  const email = await getUserAuthEmail(userId);
  return !!email && DEVELOPER_EMAILS.has(email.toLowerCase());
}

// Returns the effective workshop ID for a user:
// - Developer impersonating another workshop → impersonated workshop's ID
// - Team member → their workshop owner's ID (account_owner_id)
// - Workshop owner → their own user ID
export async function getWorkshopId(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("account_owner_id")
    .eq("id", userId)
    .maybeSingle();
  if (data?.account_owner_id) return data.account_owner_id;
  return userId;
}

// Developer-only: begin acting as another workshop. Stores target workshop ID
// on the developer's profile so getWorkshopId() redirects all queries there.
export async function startImpersonation(
  adminUserId: string,
  targetEmail: string,
): Promise<{ workshopId: string; email: string }> {
  if (!(await isDeveloperUser(adminUserId))) {
    throw new Error("Endast hedisson kan använda impersonation.");
  }
  const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(error.message);
  const target = (users.users ?? []).find(
    (u) => (u.email ?? "").toLowerCase() === targetEmail.trim().toLowerCase(),
  );
  if (!target) throw new Error("Ingen användare hittades med den e-postadressen.");

  const { data: tProfile } = await supabaseAdmin
    .from("profiles")
    .select("account_owner_id")
    .eq("id", target.id)
    .maybeSingle();
  const workshopId = tProfile?.account_owner_id ?? target.id;

  await supabaseAdmin
    .from("profiles")
    .update({ impersonating_workshop_id: workshopId } as any)
    .eq("id", adminUserId);

  return { workshopId, email: target.email ?? targetEmail };
}

// Developer-only: stop impersonating and return to own identity.
export async function stopImpersonation(adminUserId: string): Promise<void> {
  if (!(await isDeveloperUser(adminUserId))) {
    throw new Error("Endast hedisson kan avsluta impersonation.");
  }
  await supabaseAdmin
    .from("profiles")
    .update({ impersonating_workshop_id: null } as any)
    .eq("id", adminUserId);
}

// Returns current impersonation state for a user.
export async function getImpersonationStatus(userId: string): Promise<{
  isImpersonating: boolean;
  workshopId: string | null;
  email: string | null;
}> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("impersonating_workshop_id")
    .eq("id", userId)
    .maybeSingle();
  if (!data?.impersonating_workshop_id) {
    return { isImpersonating: false, workshopId: null, email: null };
  }
  const { data: user } = await supabaseAdmin.auth.admin.getUserById(data.impersonating_workshop_id);
  return {
    isImpersonating: true,
    workshopId: data.impersonating_workshop_id,
    email: user.user?.email ?? null,
  };
}

// Developer-only: generate a Supabase magic link to sign in as another user.
// The caller must be a developer. Returns the action_link URL.
export async function generateImpersonationOtp(
  adminUserId: string,
  targetEmail: string,
): Promise<{ email: string; otp: string }> {
  if (!(await isDeveloperUser(adminUserId))) {
    throw new Error("Endast hedisson kan använda impersonation.");
  }

  const email = targetEmail.trim().toLowerCase();
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw new Error(error.message);

  const otp = (data as any)?.properties?.email_otp as string | undefined;
  if (!otp) throw new Error("Kunde inte generera OTP för kontobyte.");

  return { email, otp };
}

// Developer-only: lists all auth users with their emails (for account switcher).
export async function listAllAuthUsers(): Promise<Array<{ id: string; email: string }>> {
  const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
  if (error) throw new Error(error.message);
  return (users.users ?? [])
    .filter((u) => u.email)
    .map((u) => ({ id: u.id, email: u.email! }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

// Fetches the global AI base prompt overrides set by the developer account.
// These override the bundled defaults for ALL users.
export async function getDeveloperBasePrompts(): Promise<{
  opportunity: string | null;
  service: string | null;
}> {
  const emails = Array.from(DEVELOPER_EMAILS);
  const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) return { opportunity: null, service: null };
  const devIds = (users?.users ?? [])
    .filter((u) => u.email && emails.includes(u.email.toLowerCase()))
    .map((u) => u.id);
  if (devIds.length === 0) return { opportunity: null, service: null };
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("opportunity_prompt_base, service_prompt_base")
    .in("id", devIds)
    .limit(1);
  const row = data?.[0];
  return {
    opportunity: (row?.opportunity_prompt_base ?? "")?.trim() || null,
    service: (row?.service_prompt_base ?? "")?.trim() || null,
  };
}
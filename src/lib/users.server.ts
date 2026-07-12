import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isDeveloperUser, getWorkshopProfile, getUserFeatureFlags, getWorkshopId } from "./profile.server";

// Where invited users land — the login page handles the invite token inline.
const SET_PASSWORD_PATH = "/login";

const PRODUCTION_ORIGIN = "https://sipomax.se";

// Returns the production origin. The client-supplied origin is only used when
// it looks like a real production host — localhost and Lovable/preview hosts are
// rejected so invite links always point at the live site, not a dev machine.
function canonicalOrigin(origin?: string | null): string {
  const candidate = (origin || "").trim();
  if (candidate) {
    try {
      const u = new URL(candidate);
      const host = u.hostname.toLowerCase();
      const isLocal = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
      const isPreview =
        host.endsWith(".lovable.app") ||
        host.endsWith(".lovable.dev") ||
        host.endsWith(".lovableproject.com") ||
        host.endsWith(".netlify.app");
      if (!isLocal && !isPreview && (u.protocol === "https:" || u.protocol === "http:")) {
        return u.origin;
      }
    } catch {
      // fall through
    }
  }
  return PRODUCTION_ORIGIN;
}

// An "admin" may manage users (invite/remove their own team). This is the
// developer account, every workshop owner (a profile with no account_owner_id —
// i.e. not itself a team member), plus anyone explicitly granted the 'admin'
// role. Team members (account_owner_id set) are not admins.
export async function isAdminUser(userId: string): Promise<boolean> {
  if (await isDeveloperUser(userId)) return true;
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("account_owner_id")
    .eq("id", userId)
    .maybeSingle();
  // No row yet, or a row without an owner, means this is a workshop owner.
  if (!prof || (prof as { account_owner_id: string | null }).account_owner_id == null) {
    return true;
  }
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

export async function assertAdmin(userId: string): Promise<void> {
  if (!(await isAdminUser(userId))) {
    throw new Error("Endast administratörer kan hantera användare.");
  }
}

export type ManagedUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  // No sign-in yet => the invite is still pending acceptance.
  pending: boolean;
};

export async function listManagedUsers(callerUserId: string): Promise<ManagedUser[]> {
  const isDev = await isDeveloperUser(callerUserId);
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(error.message);
  let users = data?.users ?? [];

  if (!isDev) {
    // Non-developer admins only see users in their own workshop
    const workshopId = await getWorkshopId(callerUserId);
    const { data: members } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .or(`id.eq.${workshopId},account_owner_id.eq.${workshopId}`);
    const allowedIds = new Set((members ?? []).map((m) => m.id));
    users = users.filter((u) => allowedIds.has(u.id));
  }

  // Pull display names from profiles in one query.
  const ids = users.map((u) => u.id);
  const names = new Map<string, string | null>();
  if (ids.length) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name")
      .in("id", ids);
    for (const p of profiles ?? []) names.set(p.id, p.display_name ?? null);
  }

  return users
    .map((u) => ({
      id: u.id,
      email: u.email ?? null,
      display_name: names.get(u.id) ?? null,
      created_at: u.created_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      pending: !u.last_sign_in_at,
    }))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

async function findUserByEmail(
  email: string,
): Promise<{ id: string; email: string | null } | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  // Auth has no direct get-by-email; page through the user list (capped at the
  // same 200 used elsewhere — this app manages a small team per account).
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(error.message);
  const user = (data?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === target);
  return user ? { id: user.id, email: user.email ?? null } : null;
}

// A non-developer admin (workshop owner) may only manage users inside their own
// workshop. The developer can manage anyone.
async function assertCanManageTarget(callerUserId: string, targetUserId: string): Promise<void> {
  if (await isDeveloperUser(callerUserId)) return;
  const [callerWs, targetWs] = await Promise.all([
    getWorkshopId(callerUserId),
    getWorkshopId(targetUserId),
  ]);
  if (callerWs !== targetWs) {
    throw new Error("Du kan bara hantera användare i din egen verkstad.");
  }
}

export async function getManagedUserSettings(adminUserId: string, email: string) {
  await assertAdmin(adminUserId);
  const user = await findUserByEmail(email);
  if (!user) throw new Error("Ingen användare hittades med den e-postadressen.");
  await assertCanManageTarget(adminUserId, user.id);
  const [profile, flags, { data: invoiceRow }] = await Promise.all([
    getWorkshopProfile(user.id),
    getUserFeatureFlags(user.id),
    supabaseAdmin
      .from("profiles")
      .select("invoice_logo_url, invoice_bank_details, invoice_accent_color")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const invoiceSettings = {
    invoice_logo_url: (invoiceRow as any)?.invoice_logo_url ?? null,
    invoice_bank_details: (invoiceRow as any)?.invoice_bank_details ?? null,
    invoice_accent_color: (invoiceRow as any)?.invoice_accent_color ?? "#1a56db",
  };
  return { user_id: user.id, email: user.email, profile, flags, invoiceSettings };
}

export async function adminUploadUserInvoiceLogo(
  adminUserId: string,
  targetUserId: string,
  fileBase64: string,
  fileType: string,
): Promise<string> {
  await assertAdmin(adminUserId);
  const ext = fileType === "image/svg+xml" ? "svg" : fileType.split("/")[1] ?? "png";
  const path = `${targetUserId}/logo.${ext}`;
  const buf = Buffer.from(fileBase64, "base64");
  const { error } = await supabaseAdmin.storage
    .from("invoice-logos")
    .upload(path, buf, { contentType: fileType, upsert: true });
  if (error) throw new Error(error.message);
  const { data: { publicUrl } } = supabaseAdmin.storage.from("invoice-logos").getPublicUrl(path);
  await supabaseAdmin.from("profiles").update({ invoice_logo_url: publicUrl } as never).eq("id", targetUserId);
  return publicUrl;
}

export async function updateManagedUserSettings(
  adminUserId: string,
  targetUserId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await assertAdmin(adminUserId);
  await assertCanManageTarget(adminUserId, targetUserId);
  // Settings are workshop-level: edit the target's workshop owner row so the
  // change applies to every login in that workshop.
  const workshopId = await getWorkshopId(targetUserId);
  // Ensure the row exists (getWorkshopProfile creates it when missing).
  await getWorkshopProfile(workshopId);
  const { error } = await supabaseAdmin.from("profiles").update(patch as never).eq("id", workshopId);
  if (error) throw new Error(error.message);
}

function friendlyInviteError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already") && m.includes("registered")) {
    return "En användare med den här e-postadressen finns redan.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "För många inbjudningar har skickats nyligen. Vänta en stund och försök igen.";
  }
  if (m.includes("invalid") && m.includes("email")) {
    return "Ogiltig e-postadress.";
  }
  return message;
}

export async function inviteWorkshopUser(
  inviterUserId: string,
  email: string,
  origin?: string | null,
  displayName?: string | null,
): Promise<{ id: string | null; email: string | null }> {
  const redirectTo = `${canonicalOrigin(origin)}${SET_PASSWORD_PATH}`;
  const cleanName = (displayName || "").trim();
  const inviteOpts = {
    redirectTo,
    data: cleanName ? { display_name: cleanName } : undefined,
  };

  // Determine whether the invitee should join the inviter's workshop
  // or become an independent workshop owner.
  const isDev = await isDeveloperUser(inviterUserId);
  // Developers invite independent workshop owners (no account_owner_id).
  // Workshop admins invite team members who share the workshop's data.
  const workshopId = isDev ? null : await getWorkshopId(inviterUserId);

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email.trim(), inviteOpts);

  if (error) {
    const msg = error.message.toLowerCase();
    // If the user still exists despite a prior delete (race / eventual consistency),
    // remove them and retry the invite once.
    if (msg.includes("already registered") || msg.includes("already exists") || msg.includes("user already")) {
      const existing = await findUserByEmail(email.trim());
      if (existing) {
        await supabaseAdmin.auth.admin.deleteUser(existing.id);
        const { data: data2, error: error2 } = await supabaseAdmin.auth.admin.inviteUserByEmail(
          email.trim(),
          inviteOpts,
        );
        if (error2) throw new Error(friendlyInviteError(error2.message));
        if (data2.user?.id && workshopId) {
          await supabaseAdmin
            .from("profiles")
            .update({ account_owner_id: workshopId } as any)
            .eq("id", data2.user.id);
        }
        return { id: data2.user?.id ?? null, email: data2.user?.email ?? null };
      }
    }
    throw new Error(friendlyInviteError(error.message));
  }

  // Link the new user to the inviter's workshop (if not a developer invite).
  if (data.user?.id && workshopId) {
    await supabaseAdmin
      .from("profiles")
      .update({ account_owner_id: workshopId } as any)
      .eq("id", data.user.id);
  }

  return { id: data.user?.id ?? null, email: data.user?.email ?? null };
}

export async function deleteWorkshopUser(adminUserId: string, targetUserId: string): Promise<void> {
  if (adminUserId === targetUserId) {
    throw new Error("Du kan inte ta bort ditt eget konto.");
  }
  // A workshop owner may only remove members of their own workshop; the
  // developer may remove anyone (except, below, the developer account itself).
  await assertCanManageTarget(adminUserId, targetUserId);
  // Never allow removing the platform developer account.
  if (await isDeveloperUser(targetUserId)) {
    throw new Error("Det går inte att ta bort utvecklarkontot.");
  }
  const { error } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
  if (error) throw new Error(error.message);
}

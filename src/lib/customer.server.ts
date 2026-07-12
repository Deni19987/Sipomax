import { supabaseAdmin } from "@/integrations/supabase/client.server";

function normalizeCredentialPhone(raw: string): string {
  const p = raw.replace(/[\s\-().]/g, "");
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return `+${p.slice(2)}`;
  if (p.startsWith("0")) return `+46${p.slice(1)}`;
  return `+${p}`;
}

export async function verifyJobAccess(token: string, credential: string) {
  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("job_token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Job not found");

  if (!job.customer_phone) throw new Error("Inget telefonnummer är kopplat till detta ärende");
  if (normalizeCredentialPhone(job.customer_phone) !== normalizeCredentialPhone(credential.trim())) {
    throw new Error("Uppgifterna stämmer inte");
  }
  return job;
}

export async function signJobAttachmentUrls<T extends { status_update_attachments?: Array<{ file_path: string; signed_url?: string | null }> | null }>(
  updates: T[],
  expiresInSeconds = 60 * 60,
): Promise<T[]> {
  const paths: string[] = [];
  for (const u of updates) for (const a of u.status_update_attachments ?? []) paths.push(a.file_path);
  if (!paths.length) return updates;
  const { data, error } = await supabaseAdmin.storage
    .from("job-attachments")
    .createSignedUrls(paths, expiresInSeconds);
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const d of data ?? []) {
    if (d.path && d.signedUrl) map.set(d.path, d.signedUrl);
  }
  for (const u of updates) {
    for (const a of u.status_update_attachments ?? []) {
      a.signed_url = map.get(a.file_path) ?? null;
    }
  }
  return updates;
}

export { supabaseAdmin };
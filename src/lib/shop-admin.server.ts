import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { syncProductToFortnox } from "./shop-fortnox.server";
import { assertWorkshopAccount, resolveOrderWorkshopId } from "./shop-orders.server";
import type {
  CampaignTemplate,
  ProductStatus,
  WorkshopCampaign,
  WorkshopProduct,
} from "./shop/campaigns";

// Samma mönster som shop-orders.server.ts: de nya tabellerna finns inte i den
// plattformsgenererade Database-typen, så vi typar raderna själva.
const admin = supabaseAdmin as unknown as SupabaseClient;

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  description: string | null;
  price: number;
  unit: string | null;
  image_url: string | null;
  status: ProductStatus;
  updated_at: string;
  fortnox_article_number: string | null;
  fortnox_sync_error: string | null;
  source: "app" | "fortnox";
};

const PRODUCT_SELECT =
  "id, name, brand, category, description, price, unit, image_url, status, updated_at, fortnox_article_number, fortnox_sync_error, source";

function rowToProduct(row: ProductRow): WorkshopProduct {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    description: row.description,
    price: Number(row.price),
    unit: row.unit,
    imageUrl: row.image_url,
    status: row.status,
    updatedAt: row.updated_at,
    fortnoxArticleNumber: row.fortnox_article_number ?? null,
    fortnoxSyncError: row.fortnox_sync_error ?? null,
    source: row.source ?? "app",
  };
}

type CampaignRow = {
  id: string;
  template: CampaignTemplate;
  title: string;
  message: string;
  min_order: number | null;
  active: boolean;
  updated_at: string;
};

const CAMPAIGN_SELECT = "id, template, title, message, min_order, active, updated_at";

function rowToCampaign(row: CampaignRow): WorkshopCampaign {
  return {
    id: row.id,
    template: row.template,
    title: row.title,
    message: row.message,
    minOrder: row.min_order == null ? null : Number(row.min_order),
    active: row.active,
    updatedAt: row.updated_at,
  };
}

// ── Produkter (verkstadsvyn) ────────────────────────────────────────────────

export async function listWorkshopProducts(userId: string): Promise<WorkshopProduct[]> {
  const workshopId = await assertWorkshopAccount(userId);
  const { data, error } = await admin
    .from("workshop_products")
    .select(PRODUCT_SELECT)
    .eq("workshop_id", workshopId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ProductRow[]).map(rowToProduct);
}

export type SaveProductInput = {
  id?: string | null;
  name: string;
  brand?: string | null;
  category: string;
  description?: string | null;
  price: number;
  unit?: string | null;
  status: ProductStatus;
  // Ny (beskuren) produktbild som base64, laddas upp till public storage.
  imageBase64?: string | null;
  imageType?: string | null;
};

export async function saveWorkshopProduct(
  userId: string,
  input: SaveProductInput,
): Promise<WorkshopProduct> {
  const workshopId = await assertWorkshopAccount(userId);

  let imageUrl: string | undefined;
  if (input.imageBase64 && input.imageType) {
    const ext =
      input.imageType === "image/png" ? "png" : input.imageType === "image/webp" ? "webp" : "jpg";
    const path = `${workshopId}/${crypto.randomUUID()}.${ext}`;
    const buf = Buffer.from(input.imageBase64, "base64");
    const { error: uploadError } = await supabaseAdmin.storage
      .from("product-images")
      .upload(path, buf, { contentType: input.imageType, upsert: false });
    if (uploadError) throw new Error(uploadError.message);
    imageUrl = supabaseAdmin.storage.from("product-images").getPublicUrl(path).data.publicUrl;
  }

  const patch: Record<string, unknown> = {
    name: input.name,
    brand: input.brand ?? null,
    category: input.category,
    description: input.description ?? null,
    price: input.price,
    unit: input.unit ?? null,
    status: input.status,
    ...(imageUrl ? { image_url: imageUrl } : {}),
  };

  let saved: WorkshopProduct;
  if (input.id) {
    const { data, error } = await admin
      .from("workshop_products")
      .update(patch)
      .eq("id", input.id)
      .eq("workshop_id", workshopId)
      .select(PRODUCT_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Produkten kunde inte hittas.");
    saved = rowToProduct(data as ProductRow);
  } else {
    const { data, error } = await admin
      .from("workshop_products")
      .insert({ ...patch, workshop_id: workshopId })
      .select(PRODUCT_SELECT)
      .single();
    if (error) throw new Error(error.message);
    saved = rowToProduct(data as ProductRow);
  }

  // Envägssynk: produkten speglas till Fortnox som artikel. Synken kan aldrig
  // fälla sparandet — misslyckas den sparas felet på produkten i stället.
  const { articleNumber, error: syncError } = await syncProductToFortnox(workshopId, {
    id: saved.id,
    name: saved.name,
    price: saved.price,
    unit: saved.unit,
    fortnoxArticleNumber: saved.fortnoxArticleNumber,
  });

  return { ...saved, fortnoxArticleNumber: articleNumber, fortnoxSyncError: syncError };
}

export async function deleteWorkshopProduct(userId: string, productId: string): Promise<void> {
  const workshopId = await assertWorkshopAccount(userId);
  const { error } = await admin
    .from("workshop_products")
    .delete()
    .eq("id", productId)
    .eq("workshop_id", workshopId);
  if (error) throw new Error(error.message);
}

// ── Kampanjer (verkstadsvyn) ────────────────────────────────────────────────

export async function listWorkshopCampaigns(userId: string): Promise<WorkshopCampaign[]> {
  const workshopId = await assertWorkshopAccount(userId);
  const { data, error } = await admin
    .from("workshop_campaigns")
    .select(CAMPAIGN_SELECT)
    .eq("workshop_id", workshopId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CampaignRow[]).map(rowToCampaign);
}

export type SaveCampaignInput = {
  id?: string | null;
  template: CampaignTemplate;
  title: string;
  message: string;
  minOrder?: number | null;
  active: boolean;
};

export async function saveWorkshopCampaign(
  userId: string,
  input: SaveCampaignInput,
): Promise<WorkshopCampaign> {
  const workshopId = await assertWorkshopAccount(userId);
  const patch = {
    template: input.template,
    title: input.title,
    message: input.message,
    min_order: input.minOrder ?? null,
    active: input.active,
  };

  if (input.id) {
    const { data, error } = await admin
      .from("workshop_campaigns")
      .update(patch)
      .eq("id", input.id)
      .eq("workshop_id", workshopId)
      .select(CAMPAIGN_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Kampanjen kunde inte hittas.");
    return rowToCampaign(data as CampaignRow);
  }

  const { data, error } = await admin
    .from("workshop_campaigns")
    .insert({ ...patch, workshop_id: workshopId })
    .select(CAMPAIGN_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return rowToCampaign(data as CampaignRow);
}

export async function deleteWorkshopCampaign(userId: string, campaignId: string): Promise<void> {
  const workshopId = await assertWorkshopAccount(userId);
  const { error } = await admin
    .from("workshop_campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("workshop_id", workshopId);
  if (error) throw new Error(error.message);
}

// ── Kundens vy: publicerade produkter + aktiva kampanjer ────────────────────

export async function getCustomerShopExtras(userId: string): Promise<{
  products: WorkshopProduct[];
  campaigns: WorkshopCampaign[];
}> {
  const workshopId = await resolveOrderWorkshopId(userId);
  const [{ data: products, error: productError }, { data: campaigns, error: campaignError }] =
    await Promise.all([
      admin
        .from("workshop_products")
        .select(PRODUCT_SELECT)
        .eq("workshop_id", workshopId)
        .eq("status", "published")
        .order("created_at", { ascending: false }),
      admin
        .from("workshop_campaigns")
        .select(CAMPAIGN_SELECT)
        .eq("workshop_id", workshopId)
        .eq("active", true)
        .order("updated_at", { ascending: false }),
    ]);
  if (productError) throw new Error(productError.message);
  if (campaignError) throw new Error(campaignError.message);
  return {
    products: ((products ?? []) as ProductRow[]).map(rowToProduct),
    campaigns: ((campaigns ?? []) as CampaignRow[]).map(rowToCampaign),
  };
}

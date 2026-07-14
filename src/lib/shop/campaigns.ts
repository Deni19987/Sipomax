// Delade typer för verkstadens egna produkter och kampanjer.
// Kampanjer bygger på fasta mallar — varje mall har en bestämd plats i
// kundappen så att verkstaden alltid vet var bubblan kommer att synas.

import type { Product } from "./catalog";

export type ProductStatus = "draft" | "published";

export interface WorkshopProduct {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  description: string | null;
  price: number;
  unit: string | null;
  imageUrl: string | null;
  status: ProductStatus;
  updatedAt: string;
}

// Utseendet kundappen förväntar sig (samma form som den statiska katalogen).
export type ShopProduct = Product & { imageUrl?: string | null; custom?: boolean };

export function toShopProduct(p: WorkshopProduct): ShopProduct {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand ?? "Sipomax",
    category: (p.category as Product["category"]) ?? "tillbehor",
    description: p.description ?? "",
    price: p.price,
    unit: p.unit ?? "styck",
    imageUrl: p.imageUrl,
    custom: true,
  };
}

export type CampaignTemplate = "free_shipping" | "announcement" | "product_promo";

export interface WorkshopCampaign {
  id: string;
  template: CampaignTemplate;
  title: string;
  message: string;
  minOrder: number | null;
  active: boolean;
  updatedAt: string;
}

export interface CampaignTemplateInfo {
  template: CampaignTemplate;
  name: string;
  placementLabel: string;
  description: string;
  defaultTitle: string;
  defaultMessage: string;
  hasMinOrder: boolean;
}

export const CAMPAIGN_TEMPLATES: CampaignTemplateInfo[] = [
  {
    template: "free_shipping",
    name: "Fri frakt",
    placementLabel: "Visas i varukorgen och på startsidan",
    description:
      "Sätt ett minimibelopp för fri frakt. I varukorgen räknar bubblan ut hur mycket kunden har kvar att handla för utifrån sin nuvarande varukorg.",
    defaultTitle: "Fri frakt",
    defaultMessage: "Fri frakt på beställningar över {{belopp}}",
    hasMinOrder: true,
  },
  {
    template: "announcement",
    name: "Nyhet / meddelande",
    placementLabel: "Visas överst på startsidan",
    description:
      "En bubbla på kundens startsida — perfekt för nyheter, öppettider eller ett tidsbegränsat erbjudande.",
    defaultTitle: "Nyhet!",
    defaultMessage: "Nu har vi fått in nya produkter i sortimentet.",
    hasMinOrder: false,
  },
  {
    template: "product_promo",
    name: "Produktkampanj",
    placementLabel: "Visas överst i produktlistan",
    description:
      "En banner i produktlistan som lyfter fram ett erbjudande eller en produktkategori.",
    defaultTitle: "Kampanj",
    defaultMessage: "Just nu: 10 % rabatt på alla polermedel.",
    hasMinOrder: false,
  },
];

export function getCampaignTemplate(template: CampaignTemplate): CampaignTemplateInfo {
  return CAMPAIGN_TEMPLATES.find((t) => t.template === template) ?? CAMPAIGN_TEMPLATES[0];
}

// Ersätter {{belopp}} i kampanjtexten med det formaterade minimibeloppet.
export function renderCampaignMessage(campaign: {
  message: string;
  minOrder: number | null;
}): string {
  const amount = campaign.minOrder != null ? `${campaign.minOrder.toLocaleString("sv-SE")} kr` : "";
  return campaign.message.replaceAll("{{belopp}}", amount);
}

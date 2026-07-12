import {
  Armchair,
  Brush,
  Cog,
  Droplets,
  ShieldCheck,
  Sparkles,
  SprayCan,
  type LucideIcon,
} from "lucide-react";
import type { CategoryId } from "@/lib/shop/catalog";

export const CATEGORY_ICONS: Record<CategoryId, LucideIcon> = {
  tvatt: Droplets,
  rengoring: SprayCan,
  polering: Sparkles,
  skydd: ShieldCheck,
  interior: Armchair,
  tillbehor: Brush,
  maskiner: Cog,
};

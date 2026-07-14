// Kundappens dynamiska butiksdata: verkstadens publicerade egna produkter
// och aktiva kampanjer, hämtade en gång och delade via react-query-cachen.

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getShopExtrasFn } from "@/lib/shop-admin.functions";
import { getProduct } from "./catalog";
import {
  toShopProduct,
  type CampaignTemplate,
  type ShopProduct,
  type WorkshopCampaign,
} from "./campaigns";

export function useShopExtras() {
  const { user } = useAuth();
  const fetchExtras = useServerFn(getShopExtrasFn);
  const { data } = useQuery({
    queryKey: ["shop-extras"],
    queryFn: () => fetchExtras(),
    enabled: !!user,
    staleTime: 60_000,
  });

  const customProducts: ShopProduct[] = (data?.products ?? []).map(toShopProduct);
  const campaigns: WorkshopCampaign[] = data?.campaigns ?? [];

  function findProduct(id: string): ShopProduct | undefined {
    return getProduct(id) ?? customProducts.find((p) => p.id === id);
  }

  function getCampaign(template: CampaignTemplate): WorkshopCampaign | undefined {
    return campaigns.find((c) => c.template === template);
  }

  return { customProducts, campaigns, findProduct, getCampaign };
}

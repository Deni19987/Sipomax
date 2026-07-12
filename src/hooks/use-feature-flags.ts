import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMyFeatureFlags } from "@/lib/profile.functions";

export type FeatureFlags = {
  opportunities_enabled: boolean;
  campaigns_enabled: boolean;
};

const DEFAULTS: FeatureFlags = {
  opportunities_enabled: true,
  campaigns_enabled: true,
};

// Shared, cached read of the signed-in user's feature flags. While loading we
// fall back to the permissive defaults so users who should see a feature don't
// get it briefly hidden on each navigation. Kept short-lived (and invalidated
// on save) so an admin toggling a feature is reflected promptly rather than
// staying stale for minutes.
export function useFeatureFlags(): { flags: FeatureFlags; isLoading: boolean } {
  const fetchFlags = useServerFn(getMyFeatureFlags);
  const { data, isLoading } = useQuery({
    queryKey: ["feature-flags"],
    queryFn: () => fetchFlags(),
    staleTime: 30_000,
  });
  return { flags: { ...DEFAULTS, ...(data ?? {}) }, isLoading };
}

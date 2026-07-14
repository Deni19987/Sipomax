// Utvecklarens kontobyte: en riktig Supabase-sessionsväxling via engångs-OTP.
// Den ursprungliga utvecklarsessionen sparas i localStorage (DEV_SESSION_KEY)
// så att man alltid kan ta sig tillbaka. Samma logik som i _authenticated.tsx,
// utbruten så att både verkstadsvyn och butikens kontosida kan använda den.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DEV_SESSION_KEY } from "@/lib/impersonation-client";
import { generateImpersonationOtpFn, getImpersonationStatusFn } from "@/lib/profile.functions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type DevSession = {
  access_token: string;
  refresh_token: string;
  allUsers: Array<{ id: string; email: string }>;
};

export function useAccountSwitcher() {
  const { user } = useAuth();
  const [switching, setSwitching] = useState(false);
  const fetchImpersonation = useServerFn(getImpersonationStatusFn);
  const generateOtp = useServerFn(generateImpersonationOtpFn);

  const [savedDev, setSavedDev] = useState<DevSession | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(DEV_SESSION_KEY);
      return raw ? (JSON.parse(raw) as DevSession) : null;
    } catch {
      return null;
    }
  });
  const isImpersonating = !!savedDev;

  const impersonationQuery = useQuery({
    queryKey: ["impersonation-status"],
    queryFn: () => fetchImpersonation(),
    enabled: !!user && !isImpersonating,
  });
  const isDeveloper = isImpersonating || (impersonationQuery.data?.isDeveloper ?? false);
  const allUsers: Array<{ id: string; email: string }> = isImpersonating
    ? (savedDev?.allUsers ?? [])
    : (impersonationQuery.data?.allUsers ?? []);

  // Rensa inaktuell localStorage om den aktuella sessionen redan är utvecklarens.
  useEffect(() => {
    if (!savedDev || !user) return;
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      if (!session) return;
      try {
        const payload = JSON.parse(atob(session.access_token.split(".")[1]));
        const savedPayload = JSON.parse(atob(savedDev.access_token.split(".")[1]));
        if (payload.sub === savedPayload.sub) {
          localStorage.removeItem(DEV_SESSION_KEY);
          setSavedDev(null);
        }
      } catch {
        /* ignorera parse-fel */
      }
    });
  }, [savedDev, user]);

  async function restoreDevSession() {
    if (!savedDev) return;
    setSwitching(true);
    try {
      const { error } = await supabase.auth.setSession({
        access_token: savedDev.access_token,
        refresh_token: savedDev.refresh_token,
      });
      if (error) throw error;
    } catch {
      // Rensa alltid localStorage så att användaren inte fastnar.
    } finally {
      localStorage.removeItem(DEV_SESSION_KEY);
      setSavedDev(null);
      window.location.href = "/";
    }
  }

  async function switchToAccount(targetEmail: string) {
    if (targetEmail === user?.email || switching) return;
    setSwitching(true);
    try {
      const devSessionToSave: Pick<DevSession, "access_token" | "refresh_token"> =
        isImpersonating && savedDev
          ? { access_token: savedDev.access_token, refresh_token: savedDev.refresh_token }
          : await supabase.auth.getSession().then(({ data }) => ({
              access_token: data.session?.access_token ?? "",
              refresh_token: data.session?.refresh_token ?? "",
            }));
      const usersToSave = isImpersonating && savedDev ? savedDev.allUsers : allUsers;

      // Återställ först utvecklarsessionen så att server-fn körs med rätt JWT.
      if (isImpersonating && savedDev) {
        await supabase.auth.setSession({
          access_token: savedDev.access_token,
          refresh_token: savedDev.refresh_token,
        });
      }

      const { email, otp } = await generateOtp({ data: { email: targetEmail } });

      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "email",
      });
      if (verifyError) throw new Error(verifyError.message);
      if (!verifyData.session) throw new Error("Fick ingen session efter OTP-verifiering.");

      const newSavedDev: DevSession = { ...devSessionToSave, allUsers: usersToSave };
      localStorage.setItem(DEV_SESSION_KEY, JSON.stringify(newSavedDev));
      setSavedDev(newSavedDev);

      window.location.href = "/";
    } catch (err) {
      const { data } = await supabase.auth.getSession();
      if (!data.session && savedDev) {
        await supabase.auth
          .setSession({
            access_token: savedDev.access_token,
            refresh_token: savedDev.refresh_token,
          })
          .catch(() => {});
      }
      const { toast } = await import("sonner");
      toast.error(`Kontobyte misslyckades: ${err instanceof Error ? err.message : "Okänt fel"}`);
      setSwitching(false);
    }
  }

  return {
    isDeveloper,
    isImpersonating,
    allUsers,
    switching,
    switchToAccount,
    restoreDevSession,
  };
}

export function AccountSwitcherDropdown({
  switcher,
  className,
}: {
  switcher: ReturnType<typeof useAccountSwitcher>;
  className?: string;
}) {
  const { user } = useAuth();
  const { isDeveloper, isImpersonating, allUsers, switching, switchToAccount, restoreDevSession } =
    switcher;

  if (!isDeveloper || allUsers.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={switching}
          className={cn(
            "inline-flex max-w-56 items-center gap-1 rounded px-2 py-0.5 text-sm transition-colors",
            isImpersonating
              ? "border border-amber-500/40 bg-amber-500/10 font-medium text-amber-600"
              : "text-muted-foreground hover:text-foreground",
            className,
          )}
        >
          <span className="truncate">{user?.email}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
        {allUsers.map((u) => {
          const isActive = u.email === user?.email;
          return (
            <DropdownMenuItem
              key={u.id}
              onClick={() => (isActive ? undefined : switchToAccount(u.email))}
              disabled={switching || isActive}
              className="flex cursor-pointer items-center gap-2"
            >
              <Check
                className={`h-4 w-4 flex-shrink-0 ${isActive ? "opacity-100" : "opacity-0"}`}
              />
              <span className="flex-1 truncate">{u.email}</span>
            </DropdownMenuItem>
          );
        })}
        {isImpersonating && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={restoreDevSession}
              disabled={switching}
              className="cursor-pointer font-medium"
            >
              <Check className="h-4 w-4 flex-shrink-0 opacity-0" />
              Tillbaka till eget konto
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ImpersonationBanner({
  switcher,
}: {
  switcher: ReturnType<typeof useAccountSwitcher>;
}) {
  const { user } = useAuth();
  const { isImpersonating, switching, restoreDevSession } = switcher;
  if (!isImpersonating) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-3 border-b border-amber-600 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-amber-950"
    >
      <span className="inline-flex items-center gap-1.5">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        Du agerar som <span className="underline underline-offset-2">{user?.email}</span>
      </span>
      <button
        type="button"
        onClick={restoreDevSession}
        disabled={switching}
        className="rounded bg-amber-950 px-2 py-0.5 text-xs font-semibold text-amber-50 hover:bg-amber-900 disabled:opacity-60"
      >
        Avsluta
      </button>
    </div>
  );
}

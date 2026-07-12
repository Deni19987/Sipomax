import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useScrollTopOnMount } from "@/hooks/use-scroll-top";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { SipomaxLogo } from "@/components/SipomaxLogo";

export const Route = createFileRoute("/login")({
  ssr: false,
  component: LoginPage,
});

// Capture hash params at module load time, before Supabase clears the URL hash.
// NOTE: Only relevant for the invite flow (implicit). Recovery uses PKCE so it
// arrives as a ?code= query param and is detected via onAuthStateChange instead.
const _hash =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.hash.replace(/^#/, ""))
    : new URLSearchParams();
const _capturedType = _hash.get("type"); // "invite" | "recovery" | null
const _capturedAccessToken = _hash.get("access_token") ?? null;
const _capturedRefreshToken = _hash.get("refresh_token") ?? null;

// If ?code= is present, this is a PKCE recovery/invite landing — don't navigate
// away before onAuthStateChange fires the PASSWORD_RECOVERY event.
const _hasCode =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("code");

function decodeJWTEmail(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return (payload.email as string) ?? null;
  } catch {
    return null;
  }
}

type Phase = "checking" | "login" | "forgot" | "forgot-sent" | "set-password" | "reset-password";

function LoginPage() {
  useScrollTopOnMount();
  const navigate = useNavigate();

  const capturedTypeRef = useRef(_capturedType);
  // Tracks whether PASSWORD_RECOVERY auth event has been handled so the normal
  // init() doesn't navigate to /dashboard over the top of the reset form.
  const recoveryHandledRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // PASSWORD_RECOVERY fires when Supabase exchanges the ?code= param from the
  // reset email (PKCE flow). We must handle it here before init() can navigate
  // to /dashboard.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryHandledRef.current = true;
        setEmail(session?.user?.email ?? "");
        window.history.replaceState({}, "", window.location.pathname);
        setPhase("reset-password");
      }
    });

    // Fallback: if ?code= is present but PASSWORD_RECOVERY never fires within
    // 5 seconds (expired / invalid link), show an error and fall back to login.
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    if (_hasCode) {
      fallbackTimer = setTimeout(() => {
        if (!recoveryHandledRef.current) {
          toast.error("Återställningslänken är ogiltig eller har gått ut. Begär en ny.");
          window.history.replaceState({}, "", window.location.pathname);
          setPhase("login");
        }
      }, 5000);
    }

    return () => {
      subscription.unsubscribe();
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function applyInviteSession(accessToken: string, refreshToken: string) {
      const { data: { session }, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (!mounted) return;
      if (session) {
        setEmail(session.user.email ?? "");
        window.history.replaceState({}, "", window.location.pathname);
        setPhase("set-password");
      } else {
        const msg = error?.message ?? "";
        toast.error(
          msg
            ? `Inbjudningslänken är ogiltig: ${msg}`
            : "Den här inbjudningslänken är inte längre giltig. Kontakta din administratör.",
        );
        setPhase("login");
      }
    }

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      // If onAuthStateChange already caught a PASSWORD_RECOVERY event, don't
      // override the reset-password phase or navigate away.
      if (recoveryHandledRef.current) return;

      const type = capturedTypeRef.current;

      // Recovery via the implicit hash flow (#access_token=...&type=recovery).
      // Supabase's email templates commonly use this instead of PKCE ?code=.
      // We captured the tokens at module load before Supabase cleared the hash,
      // so apply them here and show the reset form — even if already logged in.
      if (type === "recovery") {
        recoveryHandledRef.current = true;
        if (_capturedAccessToken && _capturedRefreshToken) {
          const { data: { session: recSession } } = await supabase.auth.setSession({
            access_token: _capturedAccessToken,
            refresh_token: _capturedRefreshToken,
          });
          if (!mounted) return;
          setEmail(recSession?.user?.email ?? session?.user?.email ?? "");
        } else {
          setEmail(session?.user?.email ?? "");
        }
        window.history.replaceState({}, "", window.location.pathname);
        setPhase("reset-password");
        return;
      }

      if (type === "invite") {
        if (session && _capturedAccessToken) {
          const invitedEmail = decodeJWTEmail(_capturedAccessToken);
          if (invitedEmail && session.user.email !== invitedEmail) {
            await supabase.auth.signOut();
            if (!mounted) return;
            await applyInviteSession(_capturedAccessToken, _capturedRefreshToken ?? "");
            return;
          }
        }
        if (session) {
          setEmail(session.user.email ?? "");
          window.history.replaceState({}, "", window.location.pathname);
          setPhase("set-password");
        } else if (_capturedAccessToken && _capturedRefreshToken) {
          await applyInviteSession(_capturedAccessToken, _capturedRefreshToken);
        } else {
          setPhase("login");
        }
        return;
      }

      // Normal flow — don't navigate if a ?code= is present (PKCE recovery landing)
      // or if PASSWORD_RECOVERY has already been handled.
      if (_hasCode || recoveryHandledRef.current) return;
      if (session) {
        navigate({ to: "/dashboard", viewTransition: false });
      } else {
        setPhase("login");
      }
    }

    init();
    return () => { mounted = false; };
  }, [navigate]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });
      if (error) throw error;
      // No view transition across the auth boundary: startViewTransition would
      // freeze the frame while _authenticated's beforeLoad (a network getUser)
      // and the dashboard's data load run, showing a blank / mis-positioned
      // snapshot until a reflow. A plain swap lets the dashboard render its own
      // loading state immediately.
      navigate({ to: "/dashboard", viewTransition: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      const isCredError =
        msg.toLowerCase().includes("invalid login") ||
        msg.toLowerCase().includes("invalid credentials") ||
        msg.toLowerCase().includes("email not confirmed");
      setLoginError(
        isCredError
          ? "Fel e-postadress eller lösenord. Försök igen."
          : msg || "Inloggningen misslyckades",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();

    // Client-side rate limit: Supabase allows 2 reset emails per hour.
    // Track timestamps in localStorage and block the 3rd+ attempt locally.
    const RESET_KEY = "pw_reset_attempts";
    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();
    let attempts: number[] = [];
    try { attempts = JSON.parse(localStorage.getItem(RESET_KEY) ?? "[]"); } catch { /* ignore */ }
    attempts = attempts.filter((t) => now - t < ONE_HOUR);
    if (attempts.length >= 2) {
      const waitMs = ONE_HOUR - (now - attempts[0]);
      const waitMin = Math.ceil(waitMs / 60000);
      toast.error(`Du kan bara begära återställning 2 gånger per timme. Försök igen om ca ${waitMin} minut${waitMin === 1 ? "" : "er"}.`);
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
        redirectTo: `${window.location.origin}/login`,
      });
      if (error) {
        const msg = error.message ?? "";
        const lowerMsg = msg.toLowerCase();
        const isRateLimit =
          lowerMsg.includes("rate limit") ||
          lowerMsg.includes("too many") ||
          lowerMsg.includes("once every") ||
          lowerMsg.includes("security purposes") ||
          lowerMsg.includes("over_email_send_rate_limit") ||
          (error as any).status === 429 ||
          (error as any).code === "over_email_send_rate_limit";
        toast.error(isRateLimit
          ? "Du kan bara begära återställning 2 gånger per timme. Vänta en stund och försök igen."
          : msg || "Kunde inte skicka återställningslänk");
        return;
      }
      // Record successful send
      attempts.push(now);
      localStorage.setItem(RESET_KEY, JSON.stringify(attempts));
      setPhase("forgot-sent");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("Lösenorden matchar inte.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("Lösenordet måste vara minst 8 tecken.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      window.location.href = "/dashboard";
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : "Kunde inte spara lösenordet");
    } finally {
      setLoading(false);
    }
  }

  const subtitleMap: Partial<Record<Phase, string>> = {
    "set-password": "Aktivera ditt konto",
    "reset-password": "Återställ lösenord",
    "forgot": "Glömt lösenord",
    "forgot-sent": "Glömt lösenord",
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <SipomaxLogo className="h-14 w-14 mb-4 mx-auto" />
          <h1 className="text-2xl font-semibold tracking-tight">Sipomax</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {subtitleMap[phase] ?? "Logga in för att hantera dina jobb"}
          </p>
        </div>

        {phase === "checking" && (
          <Card>
            <CardContent className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        )}

        {phase === "login" && (
          <Card>
            <CardHeader>
              <CardTitle>Logga in</CardTitle>
              <CardDescription>Välkommen tillbaka</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-post</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={loginEmail}
                    aria-invalid={!!loginError}
                    className={loginError ? "border-destructive focus-visible:ring-destructive" : ""}
                    onChange={(e) => { setLoginEmail(e.target.value); setLoginError(null); }}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Lösenord</Label>
                    <button
                      type="button"
                      onClick={() => { setForgotEmail(loginEmail); setPhase("forgot"); }}
                      className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    >
                      Glömt lösenord?
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    value={loginPassword}
                    aria-invalid={!!loginError}
                    className={loginError ? "border-destructive focus-visible:ring-destructive" : ""}
                    onChange={(e) => { setLoginPassword(e.target.value); setLoginError(null); }}
                  />
                </div>
                {loginError && (
                  <p className="text-sm text-destructive">{loginError}</p>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Logga in
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {phase === "forgot" && (
          <Card>
            <CardHeader>
              <CardTitle>Glömt lösenord</CardTitle>
              <CardDescription>Ange din e-postadress så skickar vi en återställningslänk.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleForgot} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="forgot-email">E-post</Label>
                  <Input
                    id="forgot-email"
                    type="email"
                    required
                    autoFocus
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Skicka återställningslänk
                </Button>
                <Button type="button" variant="ghost" className="w-full" onClick={() => setPhase("login")}>
                  Tillbaka till inloggning
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {phase === "forgot-sent" && (
          <Card>
            <CardHeader>
              <CardTitle>Kontrollera din e-post</CardTitle>
              <CardDescription>
                Vi har skickat en återställningslänk till <strong>{forgotEmail}</strong>. Klicka på länken i mejlet för att välja ett nytt lösenord.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="ghost" className="w-full" onClick={() => setPhase("login")}>
                Tillbaka till inloggning
              </Button>
            </CardContent>
          </Card>
        )}

        {(phase === "set-password" || phase === "reset-password") && (
          <Card>
            <CardHeader>
              <CardTitle>{phase === "reset-password" ? "Välj nytt lösenord" : "Välj ditt lösenord"}</CardTitle>
              <CardDescription>
                {email ? `Konto: ${email}. ` : ""}
                {phase === "reset-password"
                  ? "Välj ett nytt lösenord för ditt konto."
                  : "Välj ett lösenord för att aktivera ditt konto och logga in."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSetPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">Lösenord</Label>
                  <Input
                    id="new-password"
                    type="password"
                    required
                    minLength={8}
                    autoFocus
                    value={newPassword}
                    aria-invalid={!!passwordError}
                    className={passwordError ? "border-destructive focus-visible:ring-destructive" : ""}
                    onChange={(e) => { setNewPassword(e.target.value); setPasswordError(null); }}
                    placeholder="Minst 8 tecken"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Bekräfta lösenord</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    aria-invalid={!!passwordError}
                    className={passwordError ? "border-destructive focus-visible:ring-destructive" : ""}
                    onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(null); }}
                  />
                </div>
                {passwordError && (
                  <p className="text-sm text-destructive">{passwordError}</p>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  {phase === "reset-password" ? "Spara nytt lösenord" : "Aktivera konto och logga in"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}

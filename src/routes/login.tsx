import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useScrollTopOnMount } from "@/hooks/use-scroll-top";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { SipomaxLogo } from "@/components/SipomaxLogo";
import { SipomaxWordmark } from "@/components/shop/ShopShell";

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

// Set a one-shot flag so the home page tags its red header with the shared
// `brand-hero` view-transition-name — the login hero then morphs into place.
function armBrandHeroMorph() {
  try {
    sessionStorage.setItem("sipomax:brandHeroMorph", "1");
  } catch {
    /* sessionStorage unavailable — animation simply doesn't play */
  }
}

function decodeJWTEmail(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return (payload.email as string) ?? null;
  } catch {
    return null;
  }
}

type Phase =
  | "checking"
  | "login"
  | "signup"
  | "forgot"
  | "forgot-sent"
  | "set-password"
  | "reset-password";

function LoginPage() {
  useScrollTopOnMount();
  const navigate = useNavigate();

  const capturedTypeRef = useRef(_capturedType);
  // Tracks whether PASSWORD_RECOVERY auth event has been handled so the normal
  // init() doesn't navigate to the app over the top of the reset form.
  const recoveryHandledRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Sign-up form
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [signupError, setSignupError] = useState<string | null>(null);

  // PASSWORD_RECOVERY fires when Supabase exchanges the ?code= param from the
  // reset email (PKCE flow). We must handle it here before init() can navigate.
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

      // Normal flow — don't navigate if a ?code= is present (PKCE recovery
      // landing) or if PASSWORD_RECOVERY has already been handled.
      if (_hasCode || recoveryHandledRef.current) return;
      if (session) {
        navigate({ to: "/" });
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
      armBrandHeroMorph();
      navigate({ to: "/", viewTransition: true });
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

  async function handleOAuth(provider: "google" | "apple") {
    // Remember to morph the brand hero once we land back on the home page.
    armBrandHeroMorph();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/` },
      });
      // On success the browser redirects to the provider; nothing more runs here.
      if (error) throw error;
    } catch (err: unknown) {
      const name = provider === "google" ? "Google" : "Apple";
      toast.error(
        err instanceof Error ? err.message : `Kunde inte logga in med ${name} just nu.`,
      );
      setLoading(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setSignupError(null);
    if (signupPassword !== signupConfirm) {
      setSignupError("Lösenorden matchar inte.");
      return;
    }
    if (signupPassword.length < 8) {
      setSignupError("Lösenordet måste vara minst 8 tecken.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: signupEmail.trim(),
        password: signupPassword,
        options: { emailRedirectTo: `${window.location.origin}/login` },
      });
      if (error) throw error;
      if (data.session) {
        // Email confirmation disabled → the user is signed in immediately.
        armBrandHeroMorph();
        navigate({ to: "/", viewTransition: true });
      } else {
        toast.success("Konto skapat! Kolla din e-post för att bekräfta adressen.");
        setLoginEmail(signupEmail.trim());
        setPhase("login");
      }
    } catch (err: unknown) {
      setSignupError(err instanceof Error ? err.message : "Kunde inte skapa konto");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();

    // Client-side rate limit: Supabase allows 2 reset emails per hour.
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
      window.location.href = "/";
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : "Kunde inte spara lösenordet");
    } finally {
      setLoading(false);
    }
  }

  // ------- Branded screens: sign in + sign up share the red hero -------------
  if (phase === "login" || phase === "signup") {
    return (
      <div className="min-h-screen bg-neutral-100">
       <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col bg-background shadow-xl">
        <BrandHero />

        {phase === "login" ? (
          <div className="flex flex-1 flex-col px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Välkommen tillbaka!
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Logga in för att fortsätta.</p>

            <form onSubmit={handleLogin} className="mt-6 space-y-3">
              <Field
                icon={<Mail className="h-5 w-5 text-muted-foreground" />}
                invalid={!!loginError}
              >
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="E-postadress"
                  value={loginEmail}
                  onChange={(e) => { setLoginEmail(e.target.value); setLoginError(null); }}
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </Field>

              <Field
                icon={<Lock className="h-5 w-5 text-muted-foreground" />}
                invalid={!!loginError}
              >
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="current-password"
                  placeholder="Lösenord"
                  value={loginPassword}
                  onChange={(e) => { setLoginPassword(e.target.value); setLoginError(null); }}
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Dölj lösenord" : "Visa lösenord"}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </Field>

              {loginError && <p className="text-sm text-destructive">{loginError}</p>}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => { setForgotEmail(loginEmail); setPhase("forgot"); }}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  Glömt lösenord?
                </button>
              </div>

              <PrimaryButton loading={loading}>Logga in</PrimaryButton>
            </form>

            <Divider>eller fortsätt med</Divider>

            <OAuthButtons onOAuth={handleOAuth} loading={loading} />

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Har du inget konto?{" "}
              <button
                type="button"
                onClick={() => { setSignupError(null); setPhase("signup"); }}
                className="font-bold text-primary hover:underline"
              >
                Skapa konto
              </button>
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Skapa konto</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Registrera dig för att beställa och följa dina ordrar.
            </p>

            <form onSubmit={handleSignup} className="mt-6 space-y-3">
              <Field
                icon={<Mail className="h-5 w-5 text-muted-foreground" />}
                invalid={!!signupError}
              >
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="E-postadress"
                  value={signupEmail}
                  onChange={(e) => { setSignupEmail(e.target.value); setSignupError(null); }}
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </Field>

              <Field
                icon={<Lock className="h-5 w-5 text-muted-foreground" />}
                invalid={!!signupError}
              >
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Lösenord (minst 8 tecken)"
                  value={signupPassword}
                  onChange={(e) => { setSignupPassword(e.target.value); setSignupError(null); }}
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Dölj lösenord" : "Visa lösenord"}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </Field>

              <Field
                icon={<Lock className="h-5 w-5 text-muted-foreground" />}
                invalid={!!signupError}
              >
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Bekräfta lösenord"
                  value={signupConfirm}
                  onChange={(e) => { setSignupConfirm(e.target.value); setSignupError(null); }}
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </Field>

              {signupError && <p className="text-sm text-destructive">{signupError}</p>}

              <PrimaryButton loading={loading}>Skapa konto</PrimaryButton>
            </form>

            <Divider>eller registrera med</Divider>

            <OAuthButtons onOAuth={handleOAuth} loading={loading} />

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Har du redan ett konto?{" "}
              <button
                type="button"
                onClick={() => { setLoginError(null); setPhase("login"); }}
                className="font-bold text-primary hover:underline"
              >
                Logga in
              </button>
            </p>
          </div>
        )}
       </div>
      </div>
    );
  }

  // ------- Utility screens: checking / forgot / reset -----------------------
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
          <SipomaxLogo className="mx-auto mb-4 h-14 w-14 drop-shadow-md" />
          <h1 className="text-2xl font-semibold tracking-tight">Sipomax</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
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

/**
 * The red brand panel at the top of the sign-in / sign-up screens.
 * Carries the shared `brand-hero` view-transition-name: on a successful login
 * we navigate to "/", where the home page's red header claims the same name,
 * so the browser morphs this panel into its final position.
 */
function BrandHero() {
  return (
    <div
      className="relative overflow-hidden bg-gradient-to-b from-primary via-primary to-red-800 px-6 pb-16 pt-[calc(env(safe-area-inset-top)+4rem)] text-center"
      style={{ viewTransitionName: "brand-hero" }}
    >
      <SipomaxWordmark className="text-4xl tracking-[0.3em]" />
      <p className="mx-auto mt-4 max-w-[15rem] text-sm leading-relaxed text-primary-foreground/85">
        Professionella produkter.
        <br />
        Enklare vardag.
      </p>

      {/* White curve blending the red panel into the form area below. */}
      <svg
        className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-10 w-full text-background"
        viewBox="0 0 375 40"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path d="M0 8 Q187.5 44 375 8 L375 40 L0 40 Z" fill="currentColor" />
      </svg>
    </div>
  );
}

function Field({
  icon,
  invalid,
  children,
}: {
  icon: React.ReactNode;
  invalid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border bg-card px-4 py-3.5 transition-colors focus-within:border-primary ${
        invalid ? "border-destructive" : "border-border"
      }`}
    >
      {icon}
      {children}
    </div>
  );
}

function PrimaryButton({
  loading,
  children,
}: {
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-base font-bold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99] disabled:opacity-70"
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
      {children}
    </button>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="whitespace-nowrap text-xs text-muted-foreground">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function OAuthButtons({
  onOAuth,
  loading,
}: {
  onOAuth: (provider: "google" | "apple") => void;
  loading?: boolean;
}) {
  const base =
    "flex w-full items-center justify-center gap-3 rounded-2xl border border-border bg-card py-3.5 text-sm font-semibold text-foreground transition active:scale-[0.99] disabled:opacity-70";
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => onOAuth("google")} disabled={loading} className={base}>
        <GoogleIcon className="h-5 w-5" /> Fortsätt med Google
      </button>
      <button type="button" onClick={() => onOAuth("apple")} disabled={loading} className={base}>
        <AppleIcon className="h-5 w-5" /> Fortsätt med Apple
      </button>
    </div>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden xmlns="http://www.w3.org/2000/svg">
      <path d="M17.05 12.54c-.02-2.02 1.65-2.99 1.73-3.04-.94-1.38-2.41-1.57-2.93-1.59-1.25-.13-2.44.73-3.07.73-.63 0-1.61-.71-2.65-.69-1.36.02-2.62.79-3.32 2.01-1.42 2.46-.36 6.1 1.02 8.09.67.98 1.47 2.08 2.52 2.04 1.01-.04 1.39-.65 2.61-.65 1.22 0 1.56.65 2.63.63 1.09-.02 1.78-1 2.45-1.98.77-1.13 1.09-2.22 1.11-2.28-.02-.01-2.13-.82-2.15-3.25ZM15.03 6.4c.56-.68.94-1.62.83-2.56-.81.03-1.79.54-2.37 1.22-.52.6-.97 1.56-.85 2.48.9.07 1.83-.46 2.39-1.14Z" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

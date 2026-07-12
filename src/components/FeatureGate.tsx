import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

// Shown when a user opens a page that an admin has disabled for their account.
export function FeatureDisabledNotice({ title }: { title: string }) {
  return (
    <main className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
      <Link
        to="/insights"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
      >
        <ArrowLeft className="h-4 w-4" /> Tillbaka
      </Link>
      <div className="rounded-md border bg-muted/30 p-6 text-center">
        <p className="text-sm font-medium">{title} är inte aktiverat för ditt konto.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Kontakta din administratör om du behöver åtkomst.
        </p>
      </div>
    </main>
  );
}

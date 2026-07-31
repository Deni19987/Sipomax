import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Formulärfält enligt de konventioner svenska e-handelskassor följer:
 *
 * - Etiketten står ovanför fältet, aldrig som platshållare. Platshållartext
 *   försvinner när man skriver och lämnar användaren utan ledtråd vid
 *   valideringsfel.
 * - Ett fält per uppgift — inget uppdelat postnummer eller telefonnummer.
 * - Rätt tangentbord via inputMode, och autocomplete så att telefonens
 *   sparade adress kan fylla i åt användaren.
 * - Minst 48 px höjd, vilket är den träffyta som fungerar med tummen.
 * - 16 px textstorlek, annars zoomar iOS Safari in när fältet får fokus.
 */
export function FormField({
  label,
  value,
  onChange,
  autoComplete,
  inputMode,
  type = "text",
  placeholder,
  error,
  hint,
  optional,
  autoCapitalize = "sentences",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "tel" | "email";
  type?: string;
  placeholder?: string;
  error?: string | null;
  hint?: string;
  optional?: boolean;
  autoCapitalize?: "off" | "sentences" | "words";
}) {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="flex items-baseline gap-1.5 text-sm font-medium text-foreground"
      >
        {label}
        {optional && <span className="text-xs font-normal text-muted-foreground">(valfritt)</span>}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoCorrect="off"
        autoCapitalize={autoCapitalize}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={cn(
          "mt-1.5 h-12 w-full rounded-xl border bg-card px-3.5 text-base text-foreground outline-none transition-colors",
          "placeholder:text-muted-foreground/70 focus:border-foreground/40",
          error ? "border-destructive" : "border-border",
        )}
      />
      {(error || hint) && (
        <p
          id={`${id}-msg`}
          className={cn("mt-1 text-xs", error ? "text-destructive" : "text-muted-foreground")}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

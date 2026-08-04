import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ChevronRight,
  Loader2,
  Mail,
  MailCheck,
  Phone,
  Search,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { inviteShopCustomerFn, listShopCustomersFn } from "@/lib/shop-customers.functions";
import { customerLabel, type ShopCustomerSummary } from "@/lib/shop/customers";
import { formatPrice } from "@/lib/shop/catalog";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  q: z.string().optional(),
  ny: z.boolean().optional(),
});

export const Route = createFileRoute("/verkstad/kunder")({
  ssr: false,
  validateSearch: searchSchema,
  component: CustomersPage,
});

function CustomersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const fetchCustomers = useServerFn(listShopCustomersFn);

  const { data: customers, isLoading } = useQuery({
    queryKey: ["shop-customers"],
    queryFn: () => fetchCustomers(),
  });

  const [queryDraft, setQueryDraft] = useState(search.q ?? "");

  const visible = useMemo(() => {
    const term = queryDraft.trim().toLowerCase();
    const all = customers ?? [];
    if (!term) return all;
    return all.filter((customer) =>
      [customer.displayName, customer.companyName, customer.email, customer.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [customers, queryDraft]);

  const pendingCount = (customers ?? []).filter((customer) => customer.pending).length;

  function setInviteOpen(open: boolean) {
    navigate({ to: "/verkstad/kunder", search: open ? { ny: true } : {}, replace: true });
  }

  return (
    <div className="space-y-3 px-4 pt-3 lg:space-y-4 lg:pt-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground lg:text-2xl">Kunder</h1>
          <p className="text-xs text-muted-foreground lg:text-sm">
            {(customers ?? []).length} kunder
            {pendingCount > 0 ? ` · ${pendingCount} väntar på att aktivera kontot` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex h-12 flex-1 items-center gap-2.5 rounded-xl bg-card px-3.5 shadow-sm lg:h-10 lg:w-80">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={queryDraft}
              onChange={(e) => setQueryDraft(e.target.value)}
              placeholder="Sök kund, företag eller e-post…"
              autoCorrect="off"
              autoCapitalize="off"
              className="w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground lg:text-sm"
            />
            {queryDraft && (
              <button
                type="button"
                aria-label="Rensa sökningen"
                onClick={() => setQueryDraft("")}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>

          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="flex h-12 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity active:opacity-90 lg:h-10"
          >
            <UserPlus className="h-4 w-4" />
            Ny kund
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Laddar kunder…</p>
        </div>
      ) : visible.length > 0 ? (
        <div className="overflow-hidden rounded-xl bg-card shadow-sm">
          <CustomerListHeader />
          {visible.map((customer, index) => (
            <CustomerRow key={customer.id} customer={customer} withBorder={index > 0} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <UserRound className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold text-card-foreground">
            {(customers ?? []).length > 0 ? "Inga träffar" : "Inga kunder ännu"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {(customers ?? []).length > 0
              ? "Ingen kund matchar sökningen."
              : "Lägg till din första kund — de får ett mejl där de väljer sitt eget lösenord."}
          </p>
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Lägg till kund
          </button>
        </div>
      )}

      <InviteCustomerDialog open={!!search.ny} onOpenChange={setInviteOpen} />
    </div>
  );
}

const ROW_GRID =
  "lg:grid lg:grid-cols-[2.5rem_minmax(0,1.4fr)_minmax(0,1.2fr)_5rem_7rem_7rem_1.25rem] lg:items-center lg:gap-4";

function CustomerListHeader() {
  return (
    <div
      className={cn(
        "hidden border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        ROW_GRID,
      )}
    >
      <span />
      <span>Kund</span>
      <span>Kontakt</span>
      <span className="text-right">Ordrar</span>
      <span className="text-right">Totalt</span>
      <span className="text-right">Obetalt</span>
      <span />
    </div>
  );
}

function CustomerRow({
  customer,
  withBorder,
}: {
  customer: ShopCustomerSummary;
  withBorder: boolean;
}) {
  const name = customerLabel(customer);
  return (
    <Link
      to="/verkstad/kund/$id"
      params={{ id: customer.id }}
      className={cn(
        "flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-accent lg:hover:bg-accent",
        ROW_GRID,
        withBorder && "border-t border-border",
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {customer.companyName ? (
          <Building2 className="h-5 w-5" />
        ) : (
          <UserRound className="h-5 w-5" />
        )}
      </div>

      <div className="min-w-0 flex-1 lg:flex-none">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-card-foreground">{name}</p>
          {customer.pending && (
            <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              Inbjuden
            </span>
          )}
        </div>
        {customer.companyName && customer.displayName && (
          <p className="truncate text-xs text-muted-foreground">{customer.companyName}</p>
        )}
        <p className="truncate text-xs text-muted-foreground lg:hidden">
          {customer.orderCount} ordrar · {formatPrice(customer.totalSpent)}
          {customer.outstanding > 0 ? ` · ${formatPrice(customer.outstanding)} obetalt` : ""}
        </p>
      </div>

      <div className="hidden min-w-0 lg:block">
        <p className="truncate text-sm text-card-foreground">{customer.email ?? "—"}</p>
        {customer.phone && (
          <p className="truncate text-xs text-muted-foreground">{customer.phone}</p>
        )}
      </div>

      <p className="hidden text-right text-sm text-muted-foreground lg:block">
        {customer.orderCount}
      </p>
      <p className="hidden text-right text-sm font-semibold text-card-foreground lg:block">
        {formatPrice(customer.totalSpent)}
      </p>
      <p
        className={cn(
          "hidden text-right text-sm lg:block",
          customer.outstanding > 0 ? "font-semibold text-rose-600" : "text-muted-foreground",
        )}
      >
        {customer.outstanding > 0 ? formatPrice(customer.outstanding) : "—"}
      </p>

      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/** Nya kunder skapas bara härifrån — kunden får ett mejl och väljer lösenord. */
function InviteCustomerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const invite = useServerFn(inviteShopCustomerFn);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      invite({
        data: {
          email: email.trim(),
          displayName: name.trim() || null,
          companyName: company.trim() || null,
          phone: phone.trim() || null,
          origin: typeof window !== "undefined" ? window.location.origin : null,
        },
      }),
    onSuccess: (result) => {
      toast.success(`Inbjudan skickad till ${result.customer.email}.`);
      queryClient.invalidateQueries({ queryKey: ["shop-customers"] });
      setEmail("");
      setName("");
      setCompany("");
      setPhone("");
      onOpenChange(false);
      navigate({ to: "/verkstad/kund/$id", params: { id: result.customer.id } });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Kunden kunde inte bjudas in."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ny kund</DialogTitle>
          <DialogDescription>
            Kunden får ett bekräftelsemejl med en länk där hen väljer sitt eget lösenord. Först då
            är kontot aktivt.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Field
            label="E-postadress"
            icon={Mail}
            required
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="kund@foretag.se"
          />
          <Field
            label="Namn"
            icon={UserRound}
            value={name}
            onChange={setName}
            placeholder="För- och efternamn"
          />
          <Field
            label="Företag"
            icon={Building2}
            value={company}
            onChange={setCompany}
            placeholder="Företagsnamn"
          />
          <Field
            label="Telefon"
            icon={Phone}
            value={phone}
            onChange={setPhone}
            placeholder="07X-XXX XX XX"
          />

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground"
            >
              Avbryt
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || !email.trim()}
              className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MailCheck className="h-4 w-4" />
              )}
              Skicka inbjudan
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  icon: Icon,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
}: {
  label: string;
  icon: typeof Mail;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </label>
      <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          type={type}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

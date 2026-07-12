import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listCustomers } from "@/lib/jobs.functions";
import { updateFortnoxCustomer } from "@/lib/invoice.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, User, Phone, Mail, MapPin, Car, ChevronDown, ChevronRight, Pencil, Loader2 } from "lucide-react";
import { statusLabel, statusVariant } from "@/lib/status";

export const Route = createFileRoute("/_authenticated/customers")({
  component: CustomersPage,
});

type EditForm = {
  name: string;
  phone: string;
  email: string;
  orgNumber: string;
  address: string;
  zipCode: string;
  city: string;
};

function CustomersPage() {
  const fetchCustomers = useServerFn(listCustomers);
  const updateCustomer = useServerFn(updateFortnoxCustomer);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: () => fetchCustomers(),
  });
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const list = data?.customers ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((c) => {
      const hay = [
        c.customer_name,
        c.customer_phone,
        c.customer_email,
        c.customer_org_number,
        c.billing_address,
        c.billing_city,
        ...c.jobs.map((j) => j.registration_number),
        ...c.jobs.map((j) => [j.vehicle_make, j.vehicle_model].map(v => v?.replace(/\s*uppgift saknas\.?\s*/gi, "").trim() || null).filter(Boolean).join(" ")),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [data, q]);

  function startEdit(c: (typeof filtered)[number]) {
    setEditingKey(c.key);
    setEditForm({
      name: c.customer_name ?? "",
      phone: c.customer_phone ?? "",
      email: c.customer_email ?? "",
      orgNumber: c.customer_org_number ?? "",
      address: c.billing_address ?? "",
      zipCode: c.billing_postal_code ?? "",
      city: c.billing_city ?? "",
    });
  }

  async function saveEdit(customerNumber: string) {
    if (!editForm) return;
    if (!customerNumber) {
      toast.error("Kunden saknar Fortnox-kundnummer och kan inte uppdateras.");
      return;
    }
    setSaving(true);
    try {
      await updateCustomer({ data: { customerNumber, ...editForm } });
      // The server writes to Fortnox and patches the local cache, so refetching
      // the list picks up the new details immediately.
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      setEditingKey(null);
      setEditForm(null);
      toast.success("Kunduppgifter sparade i Fortnox");
    } catch (err: any) {
      toast.error(err?.message ?? "Kunde inte spara kunduppgifter");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Kunder</h1>
        <p className="text-sm text-muted-foreground">Aktuella kunduppgifter (synkade med Fortnox) samt varje kunds tidigare jobb</p>
      </div>

      <div className="relative mb-4">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Sök på namn, telefon, e-post, regnummer..."
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Laddar...</p>
      ) : !filtered.length ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {q ? "Inga kunder matchar sökningen." : "Inga kunder än."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((c) => {
            const isOpen = openKey === c.key;
            const customerNumber = (c as any).fortnox_customer_number ?? "";
            const isEditing = editingKey === c.key;
            return (
              <Card key={c.key}>
                <CardContent className="p-0">
                  <button
                    type="button"
                    onClick={() => setOpenKey(isOpen ? null : c.key)}
                    className="w-full flex items-center gap-4 p-4 text-left hover:bg-muted/40 transition-colors"
                  >
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <User className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{c.customer_name || "(okänt namn)"}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {c.customer_phone ?? "Ingen telefon"} · {c.jobs.length} jobb
                      </p>
                    </div>
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>

                  {isOpen && (
                    <div className="border-t p-4 space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Kunduppgifter{customerNumber ? ` · #${customerNumber}` : ""}
                        </p>
                        {!isEditing && (
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => startEdit(c)}>
                            <Pencil className="h-3 w-3 mr-1" />Redigera
                          </Button>
                        )}
                      </div>

                      {isEditing && editForm ? (
                        <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3">
                          <div className="space-y-1 col-span-2">
                            <Label className="text-xs">Namn</Label>
                            <Input className="h-8 text-sm" value={editForm.name}
                              onChange={(e) => setEditForm((f) => f && { ...f, name: e.target.value })} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Telefon</Label>
                            <Input className="h-8 text-sm" value={editForm.phone}
                              onChange={(e) => setEditForm((f) => f && { ...f, phone: e.target.value })} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">E-post</Label>
                            <Input type="email" className="h-8 text-sm" value={editForm.email}
                              onChange={(e) => setEditForm((f) => f && { ...f, email: e.target.value })} />
                          </div>
                          <div className="space-y-1 col-span-2">
                            <Label className="text-xs">Org./pers.nr</Label>
                            <Input className="h-8 text-sm" value={editForm.orgNumber}
                              onChange={(e) => setEditForm((f) => f && { ...f, orgNumber: e.target.value })} />
                          </div>
                          <div className="space-y-1 col-span-2">
                            <Label className="text-xs">Adress</Label>
                            <Input className="h-8 text-sm" value={editForm.address}
                              onChange={(e) => setEditForm((f) => f && { ...f, address: e.target.value })} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Postnummer</Label>
                            <Input className="h-8 text-sm" value={editForm.zipCode}
                              onChange={(e) => setEditForm((f) => f && { ...f, zipCode: e.target.value })} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Ort</Label>
                            <Input className="h-8 text-sm" value={editForm.city}
                              onChange={(e) => setEditForm((f) => f && { ...f, city: e.target.value })} />
                          </div>
                          <div className="col-span-2 flex gap-2 pt-1">
                            <Button type="button" size="sm" onClick={() => saveEdit(customerNumber)} disabled={saving}>
                              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                              Spara i Fortnox
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingKey(null); setEditForm(null); }}>Avbryt</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid sm:grid-cols-2 gap-3 text-sm">
                          {c.customer_phone && (
                            <InfoRow icon={<Phone className="h-4 w-4" />} label="Telefon" value={c.customer_phone} />
                          )}
                          {c.customer_email && (
                            <InfoRow icon={<Mail className="h-4 w-4" />} label="E-post" value={c.customer_email} />
                          )}
                          {c.customer_org_number && (
                            <InfoRow icon={<User className="h-4 w-4" />} label="Org./pers.nr" value={c.customer_org_number} />
                          )}
                          {(c.billing_address || c.billing_city) && (
                            <InfoRow
                              icon={<MapPin className="h-4 w-4" />}
                              label="Adress"
                              value={[c.billing_address, [c.billing_postal_code, c.billing_city].filter(Boolean).join(" ")]
                                .filter(Boolean)
                                .join(", ")}
                            />
                          )}
                        </div>
                      )}

                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Jobb</p>
                        <div className="grid gap-2">
                          {c.jobs.map((j) => (
                            <Link
                              key={j.id}
                              to="/jobs/$id"
                              params={{ id: j.id }}
                              className="flex items-center gap-3 p-3 rounded-md border hover:border-primary/50 transition-colors"
                            >
                              <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                                <Car className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium">{j.registration_number}</span>
                                  <span className="text-sm text-muted-foreground truncate">
                                    {[j.vehicle_make, j.vehicle_model].map(v => v?.replace(/\s*uppgift saknas\.?\s*/gi, "").trim() || null).filter(Boolean).join(" ")}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {new Date(j.updated_at).toLocaleDateString("sv-SE")}
                                  {j.archived_at ? " · Avklarat" : ""}
                                </p>
                              </div>
                              <Badge variant={statusVariant(j.current_status)}>{statusLabel(j.current_status)}</Badge>
                            </Link>
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <Button asChild size="sm" variant="outline">
                          <Link
                            to="/new-job"
                            search={{
                              customerNumber,
                              customerName: c.customer_name || "",
                              customerCompanyName: (c as any).customer_company_name || "",
                              customerPhone: c.customer_phone ?? "",
                              customerEmail: c.customer_email ?? "",
                              customerOrgNumber: c.customer_org_number ?? "",
                              billingAddress: c.billing_address ?? "",
                              billingPostalCode: c.billing_postal_code ?? "",
                              billingCity: c.billing_city ?? "",
                            }}
                          >
                            Nytt jobb
                          </Link>
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate">{value}</p>
      </div>
    </div>
  );
}

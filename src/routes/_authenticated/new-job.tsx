import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useScrollTopOnMount } from "@/hooks/use-scroll-top";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useRef, useCallback } from "react";
import { createJob } from "@/lib/jobs.functions";
import { rewriteText } from "@/lib/ai.functions";
import { lookupRegisterutdrag } from "@/lib/outlook.functions";
import { searchFortnoxCustomers, createFortnoxCustomer, updateFortnoxCustomer, checkFortnoxCustomerExists } from "@/lib/invoice.functions";
import { rankCustomers } from "@/lib/customer-match";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Sparkles, Loader2, ExternalLink, Mail, Plus, X, Clock, Check } from "lucide-react";

export const Route = createFileRoute("/_authenticated/new-job")({
  component: NewJobPage,
  validateSearch: (s: Record<string, unknown>) => ({
    customerNumber:      typeof s.customerNumber      === "string" ? s.customerNumber      : "",
    customerName:        typeof s.customerName        === "string" ? s.customerName        : "",
    customerCompanyName: typeof s.customerCompanyName === "string" ? s.customerCompanyName : "",
    customerPhone:       typeof s.customerPhone       === "string" ? s.customerPhone       : "",
    customerEmail:     typeof s.customerEmail     === "string" ? s.customerEmail     : "",
    customerOrgNumber: typeof s.customerOrgNumber === "string" ? s.customerOrgNumber : "",
    billingAddress:    typeof s.billingAddress    === "string" ? s.billingAddress    : "",
    billingPostalCode: typeof s.billingPostalCode === "string" ? s.billingPostalCode : "",
    billingCity:       typeof s.billingCity       === "string" ? s.billingCity       : "",
  }),
});

const IDENTIFIER_MODE_KEY = "workshop-identifier-mode";

const TRANSPORTSTYRELSEN_URL = "https://fordon-fu-regnr.transportstyrelsen.se/";

// iOS renders target="_blank" links from an installed home-screen app in an
// embedded SFSafariViewController sheet rather than the real Safari app.
// BankID's redirect back after signing can lose its session in that sheet.
// The "x-safari-" URL scheme is an undocumented but long-standing iOS
// mechanism that forces a genuine handoff to the Safari app instead.
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function openInRealBrowser(url: string, e: React.MouseEvent) {
  if (isIOS()) {
    e.preventDefault();
    window.location.href = url.replace(/^https:\/\//, "x-safari-https://");
  }
}

type CustomerMode = "none" | "existing" | "new";

function NewJobPage() {
  useScrollTopOnMount();
  const navigate = useNavigate();
  const prefillSearch = useSearch({ from: "/_authenticated/new-job" });
  const create = useServerFn(createJob);
  const rewrite = useServerFn(rewriteText);
  const lookup = useServerFn(lookupRegisterutdrag);
  const searchCustomers = useServerFn(searchFortnoxCustomers);
  const createCust = useServerFn(createFortnoxCustomer);
  const updateCust = useServerFn(updateFortnoxCustomer);
  const checkCustExists = useServerFn(checkFortnoxCustomerExists);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);

  // Fortnox customer search state
  const [custQuery, setCustQuery] = useState("");
  const [allCustomers, setAllCustomers] = useState<Array<{ customerNumber: string; name: string; personalName?: string; email?: string; phone?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string }>>([]);
  const [custResults, setCustResults] = useState<Array<{ customerNumber: string; name: string; personalName?: string; email?: string; phone?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string }>>([]);
  const [searchingCust, setSearchingCust] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [customerMode, setCustomerMode] = useState<CustomerMode>("none");
  const [selectedFortnoxCustomerNumber, setSelectedFortnoxCustomerNumber] = useState<string | null>(null);
  const [selectedFortnoxCustomerName, setSelectedFortnoxCustomerName] = useState<string>("");
  const [newCustDuplicate, setNewCustDuplicate] = useState<{ customerNumber: string; name: string; personalName?: string; email?: string; phone?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string } | null>(null);
  const [fortnoxRequired, setFortnoxRequired] = useState(false);
  const [fortnoxMatches, setFortnoxMatches] = useState<Array<{ customerNumber: string; name: string; personalName?: string; email?: string; phone?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string }> | null>(null);
  const [resolvingFortnox, setResolvingFortnox] = useState(false);
  const [awaitingFortnoxPick, setAwaitingFortnoxPick] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  // Customer staged from the search dropdown, waiting for confirm click
  const [pendingCustomer, setPendingCustomer] = useState<{ customerNumber: string; name: string; personalName?: string; email?: string; phone?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string } | null>(null);
  // Holds fetched email data shown in the preview bubble until user resolves customer
  const [lookupBubble, setLookupBubble] = useState<{
    name: string | null;
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_color: string | null;
    vehicle_type: string | null;
    vehicle_status: string | null;
    billing_address: string | null;
    billing_postal_code: string | null;
    billing_city: string | null;
    last_inspection_date: string | null;
    next_inspection_date: string | null;
    mileage: number | null;
    registration_number: string | null;
    customer_org_number: string | null;
    customer_is_company: boolean;
    matches: Array<{ customerNumber: string; name: string; personalName?: string; email?: string; phone?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string }>;
  } | null>(null);
  const allCustFetched = useRef(false);
  const custBoxRef = useRef<HTMLDivElement | null>(null);

  const RECENT_CUSTOMERS_KEY = "fortnox-recent-customers";
  function getRecentCustNums(): string[] {
    try { return JSON.parse(localStorage.getItem(RECENT_CUSTOMERS_KEY) ?? "[]"); } catch { return []; }
  }
  function addRecentCust(num: string) {
    const recent = getRecentCustNums().filter((n) => n !== num);
    recent.unshift(num);
    localStorage.setItem(RECENT_CUSTOMERS_KEY, JSON.stringify(recent.slice(0, 10)));
  }
  function sortCustByRecent<T extends { customerNumber: string }>(list: T[]): T[] {
    const recent = getRecentCustNums();
    if (!recent.length) return list;
    const recentSet = new Set(recent);
    const recentOnes = recent.map((n) => list.find((c) => c.customerNumber === n)).filter(Boolean) as T[];
    const rest = list.filter((c) => !recentSet.has(c.customerNumber));
    return [...recentOnes, ...rest];
  }

  const fetchAllCustomers = useCallback(async () => {
    if (allCustFetched.current) {
      setCustResults(sortCustByRecent(allCustomers));
      setCustOpen(true);
      return;
    }
    setSearchingCust(true);
    try {
      const r = await searchCustomers({ data: { query: "" } });
      allCustFetched.current = true;
      setAllCustomers(r.results);
      setCustResults(sortCustByRecent(r.results));
      setCustOpen(true);
    } catch (err: any) {
      toast.error(err?.message ?? "Kunde inte söka kunder i Fortnox");
    } finally {
      setSearchingCust(false);
    }
  }, [allCustomers, searchCustomers]);

  // Persist identifier mode in localStorage
  const [identifierMode, setIdentifierMode] = useState<"registration" | "article">(() => {
    if (typeof window === "undefined") return "registration";
    return (localStorage.getItem(IDENTIFIER_MODE_KEY) as "registration" | "article") ?? "registration";
  });
  const isArticle = identifierMode === "article";

  const [form, setForm] = useState({
    registration_number: "",
    customer_first_name: "",
    customer_last_name: "",
    customer_company_name: "",
    customer_phone: "",
    customer_email: "",
    customer_org_number: "",
    billing_address: "",
    billing_postal_code: "",
    billing_city: "",
    vehicle_make: "",
    vehicle_model: "",
    vehicle_color: "",
    vehicle_type: "",
    vehicle_status: "",
    last_inspection_date: "",
    next_inspection_date: "",
    mileage: "",
    notes: "",
  });

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function setMode(article: boolean) {
    const mode = article ? "article" : "registration";
    setIdentifierMode(mode);
    if (typeof window !== "undefined") localStorage.setItem(IDENTIFIER_MODE_KEY, mode);
    if (article) {
      setForm((f) => ({
        ...f,
        vehicle_make: "",
        vehicle_model: "",
        vehicle_color: "",
        vehicle_type: "",
        vehicle_status: "",
        mileage: "",
        last_inspection_date: "",
        next_inspection_date: "",
      }));
    }
  }

  // Fortnox customer search — filters locally when cache is loaded, otherwise hits server
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const q = custQuery.trim();
    if (allCustFetched.current) {
      // Filter + rank locally — instant, no round-trip. With a query, results
      // are ordered by match quality (name matches first); without one, by
      // recency.
      const ranked = q
        ? rankCustomers(allCustomers, q, getRecentCustNums()).slice(0, 100)
        : sortCustByRecent(allCustomers);
      setCustResults(ranked);
      setCustOpen(true);
      return;
    }
    if (!q) return;
    searchDebounceRef.current = setTimeout(async () => {
      setSearchingCust(true);
      try {
        const r = await searchCustomers({ data: { query: custQuery } });
        setCustResults(sortCustByRecent(r.results));
        setCustOpen(true);
      } catch (err: any) {
        toast.error(err?.message ?? "Kunde inte söka kunder i Fortnox");
        setCustResults([]);
      } finally {
        setSearchingCust(false);
      }
    }, 200);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [custQuery, allCustomers]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (custBoxRef.current && !custBoxRef.current.contains(e.target as Node)) setCustOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Live-check Fortnox for a name match whenever the new-customer edit
  // panel opens, in case the prefilled name already exists.
  useEffect(() => {
    if (customerMode === "new" && editingCustomer) checkNewCustDuplicate(form.customer_first_name, form.customer_last_name, form.customer_company_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerMode, editingCustomer]);

  // Selects an existing Fortnox customer record as the job's customer. This
  // is the only place (besides the edit panel's explicit save) that writes
  // customer identity fields — callers must never follow this with code that
  // overwrites the name/company fields from some other source (e.g. a
  // registration-plate lookup), or the record's true name gets clobbered.
  //
  // Fortnox itself only has a single Name field, so it can't tell us whether
  // that name is a company. `c.personalName` (populated server-side, see
  // fortnox.server.ts) is our own app's separately-tracked personal contact
  // name for customers registered under a company name — when present, it
  // means `c.name` IS the company name. `overrides` lets callers who already
  // know both parts explicitly (e.g. prefilling from one of our own job
  // records via the customers page) skip that inference entirely.
  function selectCustomer(
    c: { customerNumber: string; name: string; personalName?: string; email?: string; phone?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string },
    overrides?: { companyName?: string; personalName?: string },
  ) {
    addRecentCust(c.customerNumber);
    const companyName = overrides?.companyName ?? (c.personalName ? c.name : "");
    const personalName = overrides?.personalName ?? (companyName ? (c.personalName ?? "") : c.name);
    const displayName = companyName || personalName || c.name;
    setSelectedFortnoxCustomerNumber(c.customerNumber);
    setSelectedFortnoxCustomerName(displayName);
    setFortnoxRequired(false);
    setAwaitingFortnoxPick(false);
    setEditingCustomer(false);
    setCustomerMode("existing");
    setForm(f => ({
      ...f,
      customer_company_name: companyName,
      customer_first_name: personalName.split(/\s+/)[0] ?? "",
      customer_last_name: personalName.split(/\s+/).slice(1).join(" "),
      // Fully replace every field with the picked customer's values (empty when
      // it has none) — same as the invoice tab — so switching customers never
      // leaves a previous customer's contact/address behind.
      customer_email: c.email ?? "",
      customer_phone: c.phone ?? "",
      customer_org_number: c.orgNumber ?? "",
      billing_address: c.address ?? "",
      billing_postal_code: c.zipCode ?? "",
      billing_city: c.city ?? "",
    }));
    setCustQuery(`${displayName} (#${c.customerNumber})`);
    setCustResults([]);
    setCustOpen(false);
  }

  // Pre-select customer when navigated from the customers page
  useEffect(() => {
    const { customerNumber, customerName, customerCompanyName, customerPhone, customerEmail, customerOrgNumber, billingAddress, billingPostalCode, billingCity } = prefillSearch;
    if (!customerNumber || !customerName) return;
    selectCustomer({
      customerNumber,
      name: customerCompanyName || customerName,
      phone: customerPhone || undefined,
      email: customerEmail || undefined,
      orgNumber: customerOrgNumber || undefined,
      address: billingAddress || undefined,
      zipCode: billingPostalCode || undefined,
      city: billingCity || undefined,
    }, { companyName: customerCompanyName || undefined, personalName: customerName || undefined });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const [savingCustomerEdits, setSavingCustomerEdits] = useState(false);

  // Snapshot of customer state taken right before entering the edit panel,
  // so "Avbryt" can restore exactly the step the user was on before.
  type CustomerSnapshot = {
    customerMode: CustomerMode;
    selectedFortnoxCustomerNumber: string | null;
    selectedFortnoxCustomerName: string;
    fields: Pick<typeof form, "customer_first_name" | "customer_last_name" | "customer_company_name" | "customer_phone" | "customer_email" | "customer_org_number" | "billing_address" | "billing_postal_code" | "billing_city">;
    lookupBubble: typeof lookupBubble;
  };
  const editSnapshotRef = useRef<CustomerSnapshot | null>(null);

  function takeCustomerSnapshot(): CustomerSnapshot {
    return {
      customerMode,
      selectedFortnoxCustomerNumber,
      selectedFortnoxCustomerName,
      fields: {
        customer_first_name: form.customer_first_name,
        customer_last_name: form.customer_last_name,
        customer_company_name: form.customer_company_name,
        customer_phone: form.customer_phone,
        customer_email: form.customer_email,
        customer_org_number: form.customer_org_number,
        billing_address: form.billing_address,
        billing_postal_code: form.billing_postal_code,
        billing_city: form.billing_city,
      },
      lookupBubble,
    };
  }

  function openEditingCustomer() {
    editSnapshotRef.current = takeCustomerSnapshot();
    setEditingCustomer(true);
  }

  // Explicit save for the edit panel — the *only* path that pushes customer
  // edits to Fortnox. Diffs against the snapshot taken when editing opened,
  // so it only sends fields the user actually changed here.
  async function saveCustomerEdits() {
    if (!selectedFortnoxCustomerNumber) { setEditingCustomer(false); return; }
    const before = editSnapshotRef.current?.fields;
    const fullName = form.customer_company_name.trim() || [form.customer_first_name, form.customer_last_name].filter(Boolean).join(" ");
    const prevFullName = before
      ? before.customer_company_name.trim() || [before.customer_first_name, before.customer_last_name].filter(Boolean).join(" ")
      : fullName;
    const changed: Record<string, string> = {};
    if (fullName !== prevFullName) changed.name = fullName;
    if (!before || form.customer_phone !== before.customer_phone) changed.phone = form.customer_phone;
    if (!before || form.customer_email !== before.customer_email) changed.email = form.customer_email;
    if (!before || form.customer_org_number !== before.customer_org_number) changed.orgNumber = form.customer_org_number;
    if (!before || form.billing_address !== before.billing_address) changed.address = form.billing_address;
    if (!before || form.billing_postal_code !== before.billing_postal_code) changed.zipCode = form.billing_postal_code;
    if (!before || form.billing_city !== before.billing_city) changed.city = form.billing_city;
    if (Object.keys(changed).length === 0) { setEditingCustomer(false); return; }
    setSavingCustomerEdits(true);
    try {
      await updateCust({ data: { customerNumber: selectedFortnoxCustomerNumber, ...changed } });
      setSelectedFortnoxCustomerName(fullName);
      setEditingCustomer(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Kunde inte spara kunduppgifter i Fortnox");
      // Keep the panel open so the user doesn't lose their edits and can retry.
    } finally {
      setSavingCustomerEdits(false);
    }
  }

  // Goes straight to the full edit panel (with address etc.) for a brand
  // new customer — no separate name-only mini-step.
  function startNewCustomer(prefill?: Partial<CustomerSnapshot["fields"]>) {
    editSnapshotRef.current = takeCustomerSnapshot();
    setSelectedFortnoxCustomerNumber(null);
    setSelectedFortnoxCustomerName("");
    setCustomerMode("new");
    setCustQuery("");
    setCustResults([]);
    setCustOpen(false);
    setFortnoxRequired(false);
    setFortnoxMatches(null);
    setAwaitingFortnoxPick(false);
    setNewCustDuplicate(null);
    setForm(f => ({
      ...f,
      customer_first_name: "",
      customer_last_name: "",
      customer_company_name: "",
      customer_phone: "",
      customer_email: "",
      customer_org_number: "",
      billing_address: "",
      billing_postal_code: "",
      billing_city: "",
      ...prefill,
    }));
    setEditingCustomer(true);
  }

  // Restores whatever customer step the user was on before opening the
  // edit panel, discarding any in-progress edits.
  function cancelEditingCustomer() {
    const snap = editSnapshotRef.current;
    if (snap) {
      setCustomerMode(snap.customerMode);
      setSelectedFortnoxCustomerNumber(snap.selectedFortnoxCustomerNumber);
      setSelectedFortnoxCustomerName(snap.selectedFortnoxCustomerName);
      setForm(f => ({ ...f, ...snap.fields }));
      setLookupBubble(snap.lookupBubble);
    }
    setNewCustDuplicate(null);
    setEditingCustomer(false);
  }

  // Live-checks Fortnox for a name match instead of relying on the cached
  // customer list, which can be stale (e.g. a customer was just deleted in
  // Fortnox but is still sitting in the local cache).
  const dupCheckDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dupCheckSeq = useRef(0);
  function checkNewCustDuplicate(first: string, last: string, company?: string) {
    const fullName = company?.trim() || [first.trim(), last.trim()].filter(Boolean).join(" ");
    if (dupCheckDebounceRef.current) clearTimeout(dupCheckDebounceRef.current);
    if (!fullName) { setNewCustDuplicate(null); return; }
    const seq = ++dupCheckSeq.current;
    dupCheckDebounceRef.current = setTimeout(async () => {
      try {
        const r = await checkCustExists({ data: { name: fullName } });
        if (seq !== dupCheckSeq.current) return;
        setNewCustDuplicate(r.match ?? null);
      } catch {
        // silent — duplicate check just won't catch anything until retried
      }
    }, 300);
  }


  // Email lookup (registerutdrag) names can include middle names — keep only
  // the first and last word so they land cleanly in för-/efternamn.
  function splitLookupName(name: string | null | undefined): { first: string; last: string } {
    const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { first: "", last: "" };
    if (parts.length === 1) return { first: parts[0], last: "" };
    return { first: parts[0], last: parts[parts.length - 1] };
  }

  // Applies only vehicle/registration data from a registerutdrag lookup —
  // deliberately never touches customer identity fields (name, company name,
  // org number, address). Those must come only from an explicitly selected
  // Fortnox customer record (via selectCustomer) or from startNewCustomer's
  // own prefill, since the registration certificate's name is the *vehicle
  // owner*, which is not necessarily the workshop's actual billing customer
  // (e.g. when the real customer is a company that owns/manages the car).
  function applyVehicleFieldsFromLookup(data: typeof lookupBubble) {
    if (!data) return;
    setForm((f) => ({
      ...f,
      registration_number: data.registration_number ?? f.registration_number,
      vehicle_make: data.vehicle_make ?? f.vehicle_make,
      vehicle_model: data.vehicle_model ?? f.vehicle_model,
      vehicle_color: data.vehicle_color ?? f.vehicle_color,
      vehicle_type: data.vehicle_type ?? f.vehicle_type,
      vehicle_status: data.vehicle_status ?? f.vehicle_status,
      last_inspection_date: data.last_inspection_date ?? f.last_inspection_date,
      next_inspection_date: data.next_inspection_date ?? f.next_inspection_date,
      mileage: data.mileage != null ? String(data.mileage) : f.mileage,
    }));
  }

  async function handleLookup() {
    if (!form.registration_number.trim()) {
      toast.error("Ange registreringsnummer först");
      return;
    }
    setLookupLoading(true);
    try {
      const data = await lookup({ data: { registration_number: form.registration_number } });
      // Search for customer matches — rankCustomers now also searches personalName
      // so company-name customers are found by their underlying first+last name.
      let matches: { customerNumber: string; name: string; personalName?: string; email?: string; phone?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string }[] = [];
      const searchQuery = [data.customer_name, data.customer_org_number].filter(Boolean).join(" ").trim();
      if (searchQuery) {
        try {
          const r = allCustFetched.current
            ? { results: rankCustomers(allCustomers, searchQuery, []).slice(0, 5) }
            : await searchCustomers({ data: { query: searchQuery } });
          matches = r.results;
        } catch { /* silent */ }
      }
      setLookupBubble({
        name: data.customer_name ?? null,
        vehicle_make: data.vehicle_make ?? null,
        vehicle_model: data.vehicle_model ?? null,
        vehicle_color: data.vehicle_color ?? null,
        vehicle_type: data.vehicle_type ?? null,
        vehicle_status: data.vehicle_status ?? null,
        billing_address: data.billing_address ?? null,
        billing_postal_code: data.billing_postal_code ?? null,
        billing_city: data.billing_city ? data.billing_city.split(/\s+/)[0] : null,
        last_inspection_date: data.last_inspection_date ?? null,
        next_inspection_date: data.next_inspection_date ?? null,
        mileage: data.mileage ?? null,
        registration_number: data.registration_number ?? null,
        customer_org_number: data.customer_org_number ?? null,
        customer_is_company: data.customer_is_company ?? false,
        matches,
      });
      // Update registration number immediately
      if (data.registration_number) update("registration_number", data.registration_number);
      toast.success("Uppgifter hämtade — välj kund nedan");
      setTimeout(() => {
        document.getElementById("lookup-bubble")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    } catch (err: any) {
      toast.error(err.message ?? "Kunde inte hämta uppgifter");
    } finally {
      setLookupLoading(false);
    }
  }

  async function doSubmit(fortnoxNum: string) {
    setLoading(true);
    try {
      const { customer_first_name, customer_last_name, ...rest } = form;
      const mileage = rest.mileage ? Number(rest.mileage) : null;
      const res = await create({
        data: {
          ...rest,
          customer_first_name,
          customer_last_name,
          fortnox_customer_number: fortnoxNum,
          identifier_type: isArticle ? "article" : "registration",
          owner_count: null,
          mileage: Number.isFinite(mileage as number) ? mileage : null,
          initial_price: null,
          last_inspection_date: rest.last_inspection_date || null,
          next_inspection_date: rest.next_inspection_date || null,
          vehicle_color: rest.vehicle_color || null,
          vehicle_type: rest.vehicle_type || null,
          vehicle_status: rest.vehicle_status || null,
        },
      });
      toast.success("Jobb skapat");
      navigate({ to: "/jobs/$id", params: { id: res.job.id } });
    } catch (err: any) {
      toast.error(err.message ?? "Kunde inte skapa jobbet");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (selectedFortnoxCustomerNumber) {
      await doSubmit(selectedFortnoxCustomerNumber);
      return;
    }

    // A new customer was staged (via "Skapa kund") but not yet created in
    // Fortnox — create it now, at submit time.
    if (customerMode === "new") {
      const fullName = form.customer_company_name.trim() || [form.customer_first_name, form.customer_last_name].filter(Boolean).join(" ").trim();
      if (!fullName) {
        setFortnoxRequired(true);
        document.getElementById("fortnox-customer-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      setResolvingFortnox(true);
      try {
        const result = await createCust({
          data: {
            name: fullName,
            phone: form.customer_phone || undefined,
            email: form.customer_email || undefined,
            orgNumber: form.customer_org_number || undefined,
            address: form.billing_address || undefined,
            zipCode: form.billing_postal_code || undefined,
            city: form.billing_city || undefined,
          },
        });
        if (result.alreadyExists) {
          toast.error(`En kund med det namnet finns redan (kundnr ${result.customerNumber}). Välj den istället.`);
          // Load the existing customer's full record so "Välj den istället"
          // selects it with all its details, not just the number + name.
          let dup: { customerNumber: string; name: string; personalName?: string; email?: string; phone?: string; orgNumber?: string; address?: string; zipCode?: string; city?: string } = { customerNumber: result.customerNumber, name: fullName };
          try {
            const chk = await checkCustExists({ data: { name: fullName } });
            if (chk.match) dup = chk.match;
          } catch { /* fall back to number + name */ }
          setNewCustDuplicate(dup);
          return;
        }
        addRecentCust(result.customerNumber);
        allCustFetched.current = false;
        setSelectedFortnoxCustomerNumber(result.customerNumber);
        setSelectedFortnoxCustomerName(fullName);
        await doSubmit(result.customerNumber);
      } catch (err: any) {
        toast.error(err?.message ?? "Kunde inte skapa kund i Fortnox");
      } finally {
        setResolvingFortnox(false);
      }
      return;
    }

    setFortnoxRequired(true);
    document.getElementById("fortnox-customer-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <main className="max-w-2xl mx-auto p-4 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Nytt jobb</CardTitle>
          <CardDescription>Skapa en profil för ett fordon och en kund. Du får en delningsbar länk att skicka till kunden.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Identifier mode toggle */}
            <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/40 p-3">
              <div>
                <p className="text-sm font-medium">Använd artikelnummer</p>
                <p className="text-xs text-muted-foreground">
                  Slå på för att identifiera jobbet med ett artikelnummer i stället för ett
                  registreringsnummer. Fordonsuppgifter och hämtning från Transportstyrelsen döljs då.
                </p>
              </div>
              <Switch checked={isArticle} onCheckedChange={setMode} aria-label="Använd artikelnummer" />
            </div>

            {/* Fortnox customer — required for both modes */}
            <div id="fortnox-customer-section" className={`rounded-md border p-3 space-y-2 ${fortnoxRequired || fortnoxMatches ? "border-destructive" : ""}`}>
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Kund i Fortnox *</Label>
                {selectedFortnoxCustomerNumber ? (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                    onClick={() => (editingCustomer ? saveCustomerEdits() : openEditingCustomer())}
                    disabled={savingCustomerEdits}
                  >
                    <Check className="h-3 w-3" /> #{selectedFortnoxCustomerNumber} · {selectedFortnoxCustomerName}
                  </button>
                ) : customerMode === "new" && !editingCustomer && (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                    onClick={() => openEditingCustomer()}
                  >
                    <Check className="h-3 w-3" /> Ny kund · {form.customer_company_name.trim() || [form.customer_first_name, form.customer_last_name].filter(Boolean).join(" ")}
                  </button>
                )}
              </div>

              {resolvingFortnox ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Skapar kund i Fortnox…
                </p>
              ) : selectedFortnoxCustomerNumber ? (
                <div className="space-y-2">
                  {editingCustomer && (
                    <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-2">
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">Företagsnamn (valfritt — om ifyllt används detta som kundnamn i Fortnox)</Label>
                        <Input className="h-8 text-sm" value={form.customer_company_name}
                          onChange={e => setForm(f => ({ ...f, customer_company_name: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Förnamn</Label>
                        <Input className="h-8 text-sm" value={form.customer_first_name}
                          onChange={e => setForm(f => ({ ...f, customer_first_name: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Efternamn</Label>
                        <Input className="h-8 text-sm" value={form.customer_last_name}
                          onChange={e => setForm(f => ({ ...f, customer_last_name: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Telefon</Label>
                        <Input className="h-8 text-sm" value={form.customer_phone}
                          onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">E-post</Label>
                        <Input className="h-8 text-sm" value={form.customer_email}
                          onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Org.nr</Label>
                        <Input className="h-8 text-sm" value={form.customer_org_number}
                          onChange={e => setForm(f => ({ ...f, customer_org_number: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Adress</Label>
                        <Input className="h-8 text-sm" value={form.billing_address}
                          onChange={e => setForm(f => ({ ...f, billing_address: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Postnr</Label>
                        <Input className="h-8 text-sm" value={form.billing_postal_code}
                          onChange={e => setForm(f => ({ ...f, billing_postal_code: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Ort</Label>
                        <Input className="h-8 text-sm" value={form.billing_city}
                          onChange={e => setForm(f => ({ ...f, billing_city: e.target.value }))} />
                      </div>
                      <div className="col-span-2 flex gap-2">
                        <Button type="button" size="sm" variant="secondary" disabled={savingCustomerEdits} onClick={saveCustomerEdits}>
                          {savingCustomerEdits ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                          Klart
                        </Button>
                        <Button type="button" size="sm" variant="ghost" disabled={savingCustomerEdits} onClick={cancelEditingCustomer}>Avbryt</Button>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-destructive underline"
                    onClick={() => {
                      setSelectedFortnoxCustomerNumber(null);
                      setSelectedFortnoxCustomerName("");
                      setCustQuery("");
                      setFortnoxRequired(false);
                      setFortnoxMatches(null);
                      setAwaitingFortnoxPick(false);
                      setEditingCustomer(false);
                      fetchAllCustomers();
                    }}
                  >
                    Byt kund
                  </button>
                </div>
              ) : customerMode === "new" ? (
                <div className="space-y-2">
                  {!editingCustomer && (
                    <p className="text-xs text-muted-foreground">
                      Ny kund skapas i Fortnox när jobbet sparas.
                    </p>
                  )}
                  {editingCustomer && (
                    <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-2">
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">Företagsnamn (valfritt — om ifyllt används detta som kundnamn i Fortnox)</Label>
                        <Input className="h-8 text-sm" value={form.customer_company_name}
                          onChange={e => { setForm(f => ({ ...f, customer_company_name: e.target.value })); checkNewCustDuplicate(form.customer_first_name, form.customer_last_name, e.target.value); }} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Förnamn</Label>
                        <Input className="h-8 text-sm" value={form.customer_first_name}
                          onChange={e => { setForm(f => ({ ...f, customer_first_name: e.target.value })); checkNewCustDuplicate(e.target.value, form.customer_last_name, form.customer_company_name); }} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Efternamn</Label>
                        <Input className="h-8 text-sm" value={form.customer_last_name}
                          onChange={e => { setForm(f => ({ ...f, customer_last_name: e.target.value })); checkNewCustDuplicate(form.customer_first_name, e.target.value, form.customer_company_name); }} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Telefon</Label>
                        <Input className="h-8 text-sm" value={form.customer_phone}
                          onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">E-post</Label>
                        <Input className="h-8 text-sm" value={form.customer_email}
                          onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Org.nr</Label>
                        <Input className="h-8 text-sm" value={form.customer_org_number}
                          onChange={e => setForm(f => ({ ...f, customer_org_number: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Adress</Label>
                        <Input className="h-8 text-sm" value={form.billing_address}
                          onChange={e => setForm(f => ({ ...f, billing_address: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Postnr</Label>
                        <Input className="h-8 text-sm" value={form.billing_postal_code}
                          onChange={e => setForm(f => ({ ...f, billing_postal_code: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Ort</Label>
                        <Input className="h-8 text-sm" value={form.billing_city}
                          onChange={e => setForm(f => ({ ...f, billing_city: e.target.value }))} />
                      </div>
                      {newCustDuplicate && (
                        <p className="col-span-2 text-xs text-destructive">
                          En kund med det namnet finns redan i Fortnox (kundnr {newCustDuplicate.customerNumber}).{" "}
                          <button type="button" className="underline" onClick={() => { selectCustomer(newCustDuplicate); setEditingCustomer(false); }}>
                            Välj den istället
                          </button>.
                        </p>
                      )}
                      <div className="col-span-2 flex gap-2">
                        <Button type="button" size="sm" variant="secondary" disabled={!!newCustDuplicate || !(form.customer_company_name.trim() || form.customer_first_name.trim())} onClick={() => setEditingCustomer(false)}>Klart</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={cancelEditingCustomer}>Avbryt</Button>
                      </div>
                    </div>
                  )}
                  {!editingCustomer && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-destructive underline"
                      onClick={() => {
                        setCustomerMode("none");
                        setCustQuery("");
                        setFortnoxRequired(false);
                        setFortnoxMatches(null);
                        setAwaitingFortnoxPick(false);
                        setEditingCustomer(false);
                        setForm(f => ({
                          ...f,
                          customer_company_name: "",
                          customer_first_name: "",
                          customer_last_name: "",
                          customer_phone: "",
                          customer_email: "",
                          customer_org_number: "",
                          billing_address: "",
                          billing_postal_code: "",
                          billing_city: "",
                        }));
                        fetchAllCustomers();
                      }}
                    >
                      Byt kund
                    </button>
                  )}
                </div>
              ) : fortnoxMatches ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-destructive font-medium">Flera kunder med samma namn hittades — välj vilken som stämmer:</p>
                  {fortnoxMatches.map(c => (
                    <button
                      key={c.customerNumber}
                      type="button"
                      className="w-full text-left px-3 py-2 rounded border hover:bg-muted text-sm flex items-center gap-2"
                      onClick={() => { selectCustomer(c); setFortnoxMatches(null); }}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">
                        #{c.customerNumber}{c.city ? ` · ${c.city}` : ""}{c.phone ? ` · ${c.phone}` : ""}
                      </span>
                    </button>
                  ))}
                  <button type="button" className="text-xs text-muted-foreground hover:underline pt-0.5" onClick={() => setFortnoxMatches(null)}>Avbryt</button>
                </div>
              ) : (
                <div ref={custBoxRef} className="relative space-y-1">
                  <div className="relative">
                    <Input
                      value={custQuery}
                      onChange={e => setCustQuery(e.target.value)}
                      onFocus={() => { if (!custOpen) fetchAllCustomers(); }}
                      placeholder="Sök på namn, telefon, e-post, org.nr…"
                      className="h-9 text-sm"
                    />
                    {searchingCust && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                    {custOpen && (custResults.length > 0 || searchingCust) && (
                      <div className="absolute z-30 top-full left-0 right-0 mt-1 rounded-md border bg-popover shadow-md flex flex-col max-h-[50dvh] sm:max-h-72">
                        <div className="overflow-y-auto overscroll-contain flex-1">
                          {searchingCust && custResults.length === 0 ? (
                            <p className="px-3 py-3 text-sm text-muted-foreground">Söker…</p>
                          ) : (
                            <ul className="divide-y">
                              {custResults.map(c => {
                                const isRecent = getRecentCustNums().includes(c.customerNumber);
                                return (
                                  <li key={c.customerNumber}>
                                    <button type="button"
                                      className="w-full text-left px-3 py-2.5 sm:py-2 hover:bg-muted active:bg-muted/80 flex items-center gap-2 text-sm"
                                      onClick={() => { setPendingCustomer(c); setCustOpen(false); }}>
                                      {isRecent && <Clock className="h-3 w-3 text-muted-foreground shrink-0" />}
                                      <span className="font-medium">{c.name}</span>
                                      <span className="text-xs text-muted-foreground truncate">
                                        #{c.customerNumber}{c.city ? ` · ${c.city}` : ""}{c.phone ? ` · ${c.phone}` : ""}
                                      </span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                        <button type="button"
                          className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors flex items-center gap-2 text-primary border-t shrink-0"
                          onClick={() => startNewCustomer()}>
                          <Plus className="h-3.5 w-3.5" />
                          <span className="text-sm font-medium">Skapa ny kund i Fortnox</span>
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Pending customer confirmation bubble */}
                  {pendingCustomer && (
                    <div className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                      <p className="text-xs font-medium text-emerald-900">Bekräfta kund</p>
                      <div className="text-sm font-medium">{pendingCustomer.name}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-emerald-900">Telefon</Label>
                          <Input className="h-8 text-sm bg-white" value={pendingCustomer.phone ?? ""}
                            onChange={e => setPendingCustomer(c => c && { ...c, phone: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-emerald-900">E-post</Label>
                          <Input className="h-8 text-sm bg-white" value={pendingCustomer.email ?? ""}
                            onChange={e => setPendingCustomer(c => c && { ...c, email: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-emerald-900">Adress</Label>
                          <Input className="h-8 text-sm bg-white" value={pendingCustomer.address ?? ""}
                            onChange={e => setPendingCustomer(c => c && { ...c, address: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-emerald-900">Postnr</Label>
                          <Input className="h-8 text-sm bg-white" value={pendingCustomer.zipCode ?? ""}
                            onChange={e => setPendingCustomer(c => c && { ...c, zipCode: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-emerald-900">Ort</Label>
                          <Input className="h-8 text-sm bg-white" value={pendingCustomer.city ?? ""}
                            onChange={e => setPendingCustomer(c => c && { ...c, city: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-emerald-900">Org.nr</Label>
                          <Input className="h-8 text-sm bg-white" value={pendingCustomer.orgNumber ?? ""}
                            onChange={e => setPendingCustomer(c => c && { ...c, orgNumber: e.target.value })} />
                        </div>
                      </div>
                      <div className="text-xs text-emerald-500">Kundnr #{pendingCustomer.customerNumber}</div>
                      <div className="flex gap-2 pt-1">
                        <Button type="button" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => { selectCustomer(pendingCustomer); setPendingCustomer(null); }}>
                          <Check className="h-3.5 w-3.5 mr-1" /> Bekräfta
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => setPendingCustomer(null)}>Avbryt</Button>
                      </div>
                    </div>
                  )}
                  <button type="button" onClick={() => startNewCustomer()}
                    className="flex items-center gap-1 text-xs text-primary hover:underline pt-0.5">
                    <Plus className="h-3 w-3" /> Skapa ny kund i Fortnox
                  </button>
                  {fortnoxRequired && <p className="text-xs text-destructive">Välj eller skapa en kund i Fortnox innan du sparar jobbet.</p>}
                </div>
              )}
            </div>

            {/* Article number / registration number */}
            <div className="space-y-2">
              <Label htmlFor="reg">{isArticle ? "Artikelnummer *" : "Registreringsnummer *"}</Label>
              <Input
                id="reg"
                required
                value={form.registration_number}
                onChange={(e) =>
                  update("registration_number", isArticle ? e.target.value : e.target.value.toUpperCase())
                }
                placeholder={isArticle ? "ART-12345" : "ABC123"}
                className="text-lg font-mono tracking-wider"
                onInvalid={(e) =>
                  (e.target as HTMLInputElement).setCustomValidity(
                    isArticle ? "Fyll i artikelnummer" : "Fyll i registreringsnummer",
                  )
                }
                onInput={(e) => (e.target as HTMLInputElement).setCustomValidity("")}
              />
            </div>

            {/* Registration mode: vehicle lookup */}
            {!isArticle && (
              <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                <p className="text-sm font-medium">Hämta fordonsuppgifter automatiskt</p>
                <p className="text-xs text-muted-foreground">
                  1) Beställ ett Registerutdrag från Transportstyrelsen — ange e-postadressen{" "}
                  <span className="font-mono font-medium text-foreground">deni.ferchichi@scandicreach.se</span>{" "}
                  som mottagare. 2) Ange registreringsnumret ovan och klicka på &quot;Hämta från e-post&quot; för att autofylla fälten.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild type="button" variant="outline" size="sm">
                    <a
                      href={TRANSPORTSTYRELSEN_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => openInRealBrowser(TRANSPORTSTYRELSEN_URL, e)}
                      className="gap-1.5"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Beställ registerutdrag
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={lookupLoading || !form.registration_number.trim()}
                    onClick={handleLookup}
                    className="gap-1.5"
                    title={
                      !form.registration_number.trim()
                        ? "Ange registreringsnummer först"
                        : "Hämta fordonsuppgifter från Outlook"
                    }
                  >
                    {lookupLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                    Hämta från e-post
                  </Button>
                </div>

                {/* Lookup result bubble */}
                {lookupBubble && (
                  <div id="lookup-bubble" className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-3 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-blue-900">Uppgifter från Registerutdrag</p>
                      <button type="button" onClick={() => setLookupBubble(null)} className="text-blue-400 hover:text-blue-700">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-blue-900">
                      {lookupBubble.name && <span><span className="text-blue-500">Namn</span> · {lookupBubble.name}</span>}
                      {lookupBubble.vehicle_make && <span><span className="text-blue-500">Märke</span> · {lookupBubble.vehicle_make}</span>}
                      {lookupBubble.vehicle_model && <span><span className="text-blue-500">Modell</span> · {lookupBubble.vehicle_model}</span>}
                      {lookupBubble.vehicle_color && <span><span className="text-blue-500">Färg</span> · {lookupBubble.vehicle_color}</span>}
                      {lookupBubble.mileage != null && <span><span className="text-blue-500">Mätarst.</span> · {lookupBubble.mileage.toLocaleString("sv-SE")} km</span>}
                      {lookupBubble.billing_city && <span><span className="text-blue-500">Ort</span> · {lookupBubble.billing_city}</span>}
                    </div>

                    {/* Customer resolution */}
                    {lookupBubble.matches.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-blue-800">Matchande kund i Fortnox — välj eller skapa ny:</p>
                        {lookupBubble.matches.slice(0, 5).map(c => (
                          <button key={c.customerNumber} type="button"
                            className="w-full text-left px-2.5 py-1.5 rounded border border-blue-200 bg-white hover:bg-blue-50 text-sm flex items-center gap-2"
                            onClick={() => {
                              selectCustomer(c);
                              applyVehicleFieldsFromLookup(lookupBubble);
                              setLookupBubble(null);
                            }}>
                            <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                            <span className="font-medium">{c.name}</span>
                            <span className="text-xs text-muted-foreground">#{c.customerNumber}{c.city ? ` · ${c.city}` : ""}{c.phone ? ` · ${c.phone}` : ""}</span>
                          </button>
                        ))}
                        <button type="button"
                          className="flex items-center gap-1 text-xs text-blue-700 hover:underline pt-0.5"
                          onClick={() => {
                            applyVehicleFieldsFromLookup(lookupBubble);
                            const bubble = lookupBubble;
                            setLookupBubble(null);
                            startNewCustomer({
                              customer_company_name: bubble.customer_is_company ? (bubble.name ?? "") : "",
                              customer_first_name: bubble.customer_is_company ? "" : splitLookupName(bubble.name).first,
                              customer_last_name: bubble.customer_is_company ? "" : splitLookupName(bubble.name).last,
                              customer_org_number: bubble.customer_org_number ?? "",
                              billing_address: bubble.billing_address ?? "",
                              billing_postal_code: bubble.billing_postal_code ?? "",
                              billing_city: bubble.billing_city ?? "",
                            });
                          }}>
                          <Plus className="h-3 w-3" /> Skapa ny kund i Fortnox ändå
                        </button>
                      </div>
                    ) : (
                      <button type="button"
                        className="flex items-center gap-1.5 text-xs font-medium text-blue-700 border border-blue-300 rounded px-2.5 py-1.5 bg-white hover:bg-blue-50"
                        onClick={() => {
                          applyVehicleFieldsFromLookup(lookupBubble);
                          const bubble = lookupBubble;
                          setLookupBubble(null);
                          startNewCustomer({
                            customer_company_name: bubble.customer_is_company ? (bubble.name ?? "") : "",
                            customer_first_name: bubble.customer_is_company ? "" : splitLookupName(bubble.name).first,
                            customer_last_name: bubble.customer_is_company ? "" : splitLookupName(bubble.name).last,
                            customer_org_number: bubble.customer_org_number ?? "",
                            billing_address: bubble.billing_address ?? "",
                            billing_postal_code: bubble.billing_postal_code ?? "",
                            billing_city: bubble.billing_city ?? "",
                          });
                        }}>
                        <Plus className="h-3.5 w-3.5" /> Lägg till i Fortnox
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}


            <div className="space-y-2 pt-2 border-t">
              <Label htmlFor="notes">Intern anteckning <span className="text-xs font-normal text-muted-foreground">(visas ej för kunden)</span></Label>
              <Textarea
                id="notes"
                rows={4}
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder="Vad behöver göras? Beskriv arbetet..."
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={aiLoading || !form.notes.trim()}
                  onClick={async () => {
                    setAiLoading(true);
                    try {
                      const res = await rewrite({ data: { text: form.notes, mode: "customer_update" } });
                      update("notes", res.text);
                      toast.success("Omskriven med AI");
                    } catch (err: any) {
                      toast.error(err.message ?? "AI-omskrivning misslyckades");
                    } finally {
                      setAiLoading(false);
                    }
                  }}
                  className="h-7 px-2 text-xs gap-1.5"
                  title={form.notes.trim() ? "Skriv om anteckningen med AI" : "Skriv något i anteckningar först"}
                >
                  {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Generera med AI
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => navigate({ to: "/dashboard" })}>Avbryt</Button>
              <Button type="submit" disabled={loading}>{loading ? "Skapar..." : "Skapa jobb"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

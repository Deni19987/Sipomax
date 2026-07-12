import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { FortnoxCompanyInfo } from "./fortnox.server";

export interface InvoicePdfSettings {
  logoUrl: string | null;
  accentColor: string;
  bankDetails: {
    bankgiro?: string | null;
    plusgiro?: string | null;
    iban?: string | null;
    bic?: string | null;
    clearingNumber?: string | null;
    accountNumber?: string | null;
    paymentNote?: string | null;
    fTax?: boolean | null;
  } | null;
}

export interface InvoicePdfData {
  invoiceId: string;
  ocr?: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  customerNumber?: string | null;
  ourReference?: string | null;
  yourReference?: string | null;
  paymentTerms?: string | null;
  penaltyInterest?: string | null;
  rows: Array<{
    description: string;
    articleNumber?: string | null;
    unit?: string | null;
    quantity: number;
    price: number;
    vat: number;
  }>;
  net: number;
  vat: number;
  total: number;
  customer: {
    name: string;
    address?: string | null;
    zipCode?: string | null;
    city?: string | null;
    country?: string | null;
    email?: string | null;
  };
  company: FortnoxCompanyInfo;
  settings: InvoicePdfSettings;
}

const S = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#111",
    paddingHorizontal: 40,
    paddingTop: 28,
    paddingBottom: 110,
    backgroundColor: "#fff",
  },

  // "Sida 1(1)" pinned top-right
  pageNumber: { position: "absolute", top: 14, right: 40, fontSize: 8, color: "#444" },

  // ── Three-column header: [Logo 38%] [Faktura+Customer 32%] [Meta 30%] ──
  headerRow: { flexDirection: "row", marginBottom: 18, marginTop: 4 },

  headerLogo: { width: "38%" },
  logoImg: { width: 180, height: 72, objectFit: "contain", objectPosition: "left top" },
  logoFallback: { fontSize: 14, fontFamily: "Helvetica-Bold" },

  headerCenter: { width: "32%", paddingTop: 2 },
  invoiceTitle: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 10 },
  customerLine: { fontSize: 9, lineHeight: 1.5 },

  headerRight: { width: "30%", paddingTop: 2 },
  metaPair: { flexDirection: "row", marginBottom: 3 },
  metaKey: { color: "#444", fontSize: 8.5, width: 80 },
  metaVal: { fontSize: 8.5 },

  // ── Divider ──
  divider: { borderBottomWidth: 0.75, borderBottomColor: "#bbb", marginBottom: 8 },
  dividerThick: { borderBottomWidth: 0.75, borderBottomColor: "#bbb", marginBottom: 0 },

  // ── References row: 3 columns matching header proportions ──
  // Col1(38%): Kundnr/Er ref  |  Col2(32%): labels  |  Col3(30%): values
  // This makes "Vår referens" align with "Faktura" and values align with meta column
  refsRow: { flexDirection: "row", paddingVertical: 8 },
  refsCol1: { width: "38%", flexDirection: "column", gap: 3 },
  refsCol2: { width: "32%", flexDirection: "column", gap: 3 },
  refsCol3: { width: "30%", flexDirection: "column", gap: 3 },
  refKey: { color: "#444", fontSize: 8.5 },
  refVal: { fontSize: 8.5 },

  // ── Table — 6 equal-flex columns spread across full page width ──
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 0.75,
    borderTopWidth: 0.75,
    borderColor: "#888",
    paddingVertical: 4,
    marginTop: 24,
  },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ddd", paddingVertical: 4 },
  thText: { fontSize: 8.5, color: "#333" },
  tdText: { fontSize: 8.5 },
  tdMuted: { fontSize: 8.5, color: "#555" },
  colArt: { flex: 1 },
  colDesc: { flex: 2.5 },
  colQty: { flex: 1, textAlign: "right" },
  colUnit: { flex: 1, textAlign: "left" },
  colPrice: { flex: 1.2, textAlign: "right" },
  colTotal: { flex: 1.1, textAlign: "right" },

  // ── Totals ──
  totalsSection: { marginTop: 12, borderTopWidth: 0.75, borderTopColor: "#bbb", paddingTop: 8 },
  totalsRow: { flexDirection: "row" },
  totalsCol: { flex: 1 },
  totalsLabel: { fontSize: 8, color: "#444", marginBottom: 2 },
  totalsValue: { fontSize: 9 },
  grandTotalLabel: { fontSize: 8, color: "#444", marginBottom: 2, fontFamily: "Helvetica-Bold" },
  grandTotalValue: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  vatBreakdownRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  vatBreakdown: { fontSize: 8, color: "#444" },
  ibanLine: { fontSize: 8, color: "#444", textAlign: "right" },

  // ── Footer — pinned to bottom ──
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 0.75,
    borderTopColor: "#bbb",
    paddingTop: 8,
    flexDirection: "row",
  },
  footerCol: { flex: 1 },
  footerLabel: { fontSize: 7.5, color: "#555", marginBottom: 2 },
  footerValue: { fontSize: 8, lineHeight: 1.5 },
});

function fmt(n: number) {
  return n.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPaymentTerms(terms: string | null | undefined): string {
  if (!terms) return "";
  const n = Number(terms);
  if (!isNaN(n) && n > 0) return `${n} dagar`;
  return terms;
}

export function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  const bank = data.settings.bankDetails;
  const co = data.company;
  const cu = data.customer;

  const vatGroups: Record<number, { base: number; amount: number }> = {};
  for (const r of data.rows) {
    const base = r.quantity * r.price;
    const amt = base * (r.vat / 100);
    vatGroups[r.vat] = vatGroups[r.vat] ?? { base: 0, amount: 0 };
    vatGroups[r.vat].base += base;
    vatGroups[r.vat].amount += amt;
  }
  const vatLines = Object.entries(vatGroups)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([pct, v]) => `Moms ${pct}% ${fmt(v.amount)} (${fmt(v.base)})`);

  const paymentTermsStr = fmtPaymentTerms(data.paymentTerms);

  const ibanLine = bank?.iban
    ? [`IBAN ${bank.iban}`, bank.bic ? `BIC ${bank.bic}` : null].filter(Boolean).join("  ")
    : null;

  return (
    <Document>
      <Page size="A4" style={S.page}>
        {/* Sida 1(1) top-right */}
        <Text
          style={S.pageNumber}
          render={({ pageNumber, totalPages }) => `Sida ${pageNumber}(${totalPages})`}
          fixed
        />

        {/* ── Three-column header ── */}
        <View style={S.headerRow}>
          {/* Column 1: Logo */}
          <View style={S.headerLogo}>
            {data.settings.logoUrl ? (
              <Image src={data.settings.logoUrl} style={S.logoImg} />
            ) : (
              <Text style={S.logoFallback}>{co.companyName}</Text>
            )}
          </View>

          {/* Column 2: "Faktura" title + customer address (all bold) */}
          <View style={S.headerCenter}>
            <Text style={S.invoiceTitle}>Faktura</Text>
            {cu.name && <Text style={S.customerLine}>{cu.name}</Text>}
            {cu.address && <Text style={S.customerLine}>{cu.address}</Text>}
            {(cu.zipCode || cu.city) && (
              <Text style={S.customerLine}>
                {[cu.zipCode, cu.city].filter(Boolean).join(" ")}
              </Text>
            )}
            {cu.country ? (
              <Text style={S.customerLine}>{cu.country}</Text>
            ) : (
              <Text style={S.customerLine}>Sverige</Text>
            )}
          </View>

          {/* Column 3: Invoice meta */}
          <View style={S.headerRight}>
            <View style={S.metaPair}>
              <Text style={S.metaKey}>Fakturadatum</Text>
              <Text style={S.metaVal}>{data.invoiceDate ?? "—"}</Text>
            </View>
            <View style={S.metaPair}>
              <Text style={S.metaKey}>Fakturanr</Text>
              <Text style={S.metaVal}>{data.invoiceId}</Text>
            </View>
            {data.ocr && (
              <View style={S.metaPair}>
                <Text style={S.metaKey}>OCR</Text>
                <Text style={S.metaVal}>{data.ocr}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Refs row: 3 columns matching header proportions ── */}
        {/* Col1(38%): Kundnr/Er ref  |  Col2(32%): labels  |  Col3(30%): values */}
        <View style={S.refsRow}>
          <View style={S.refsCol1}>
            {data.customerNumber && (
              <Text style={S.refVal}>Kundnr  {data.customerNumber}</Text>
            )}
            {data.yourReference && (
              <Text style={S.refVal}>Er referens  {data.yourReference}</Text>
            )}
          </View>
          <View style={S.refsCol2}>
            {data.ourReference && <Text style={S.refKey}>Vår referens</Text>}
            {paymentTermsStr && <Text style={S.refKey}>Betalningsvillkor</Text>}
            {data.dueDate && <Text style={S.refKey}>Förfallodatum</Text>}
            {data.penaltyInterest && <Text style={S.refKey}>Dröjsmålsränta</Text>}
          </View>
          <View style={S.refsCol3}>
            {data.ourReference && <Text style={S.refVal}>{data.ourReference}</Text>}
            {paymentTermsStr && <Text style={S.refVal}>{paymentTermsStr}</Text>}
            {data.dueDate && <Text style={S.refVal}>{data.dueDate}</Text>}
            {data.penaltyInterest && <Text style={S.refVal}>{data.penaltyInterest}</Text>}
          </View>
        </View>

        <View style={S.dividerThick} />

        {/* ── Table ── */}
        <View style={S.tableHeaderRow}>
          <Text style={[S.thText, S.colArt]}>Artnr</Text>
          <Text style={[S.thText, S.colDesc]}>Benämning</Text>
          <Text style={[S.thText, S.colQty]}>Lev ant</Text>
          <Text style={[S.thText, S.colUnit]}>Enhet</Text>
          <Text style={[S.thText, S.colPrice]}>À-pris</Text>
          <Text style={[S.thText, S.colTotal]}>Summa</Text>
        </View>

        {data.rows.map((r, i) => (
          <View key={i} style={S.tableRow}>
            <Text style={[S.tdMuted, S.colArt]}>{r.articleNumber ?? ""}</Text>
            <Text style={[S.tdText, S.colDesc]}>{r.description}</Text>
            <Text style={[S.tdText, S.colQty]}>{r.quantity > 0 ? fmt(r.quantity) : ""}</Text>
            <Text style={[S.tdMuted, S.colUnit]}>{r.unit ?? ""}</Text>
            <Text style={[S.tdText, S.colPrice]}>{r.price > 0 ? fmt(r.price) : "0,00"}</Text>
            <Text style={[S.tdText, S.colTotal]}>
              {r.quantity > 0 && r.price > 0 ? fmt(r.quantity * r.price) : "0,00"}
            </Text>
          </View>
        ))}

        <View style={{ flexGrow: 1 }} />

        {/* ── Totals ── */}
        <View style={S.totalsSection}>
          <View style={S.totalsRow}>
            <View style={S.totalsCol}>
              <Text style={S.totalsLabel}>Exkl. moms</Text>
              <Text style={S.totalsValue}>{fmt(data.net)}</Text>
            </View>
            <View style={S.totalsCol}>
              <Text style={S.totalsLabel}>Moms</Text>
              <Text style={S.totalsValue}>{fmt(data.vat)}</Text>
            </View>
            <View style={S.totalsCol}>
              <Text style={S.totalsLabel}>Totalt</Text>
              <Text style={S.totalsValue}>{fmt(data.total)}</Text>
            </View>
            <View style={S.totalsCol}>
              <Text style={S.grandTotalLabel}>ATT BETALA</Text>
              <Text style={S.grandTotalValue}>
                {data.currency} {fmt(data.total)}
              </Text>
            </View>
          </View>
          <View style={S.vatBreakdownRow}>
            <Text style={S.vatBreakdown}>{vatLines.join("  ")}</Text>
            {ibanLine && <Text style={S.ibanLine}>{ibanLine}</Text>}
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={S.footer} fixed>
          <View style={S.footerCol}>
            <Text style={S.footerLabel}>Adress</Text>
            <Text style={S.footerValue}>{co.companyName}</Text>
            {co.address && <Text style={S.footerValue}>{co.address}</Text>}
            {(co.zipCode || co.city) && (
              <Text style={S.footerValue}>{[co.zipCode, co.city].filter(Boolean).join(" ")}</Text>
            )}
            <Text style={S.footerValue}>Sverige</Text>
          </View>

          <View style={S.footerCol}>
            {co.phone && (
              <>
                <Text style={S.footerLabel}>Telefon</Text>
                <Text style={S.footerValue}>{co.phone}</Text>
              </>
            )}
            {co.email && (
              <>
                <Text style={[S.footerLabel, { marginTop: co.phone ? 6 : 0 }]}>E-post</Text>
                <Text style={S.footerValue}>{co.email}</Text>
              </>
            )}
          </View>

          <View style={S.footerCol}>
            {bank?.bankgiro && (
              <>
                <Text style={S.footerLabel}>Bankgiro</Text>
                <Text style={S.footerValue}>{bank.bankgiro}</Text>
              </>
            )}
            {bank?.plusgiro && (
              <>
                <Text style={[S.footerLabel, { marginTop: bank?.bankgiro ? 6 : 0 }]}>Plusgiro</Text>
                <Text style={S.footerValue}>{bank.plusgiro}</Text>
              </>
            )}
            {bank?.clearingNumber && (
              <>
                <Text style={S.footerLabel}>Clearingnr</Text>
                <Text style={S.footerValue}>{bank.clearingNumber}</Text>
              </>
            )}
            {bank?.accountNumber && (
              <>
                <Text style={[S.footerLabel, { marginTop: bank?.clearingNumber ? 6 : 0 }]}>Kontonr</Text>
                <Text style={S.footerValue}>{bank.accountNumber}</Text>
              </>
            )}
          </View>

          <View style={S.footerCol}>
            {co.organisationNumber && (
              <>
                <Text style={S.footerLabel}>Organisationsnr</Text>
                <Text style={S.footerValue}>{co.organisationNumber}</Text>
              </>
            )}
            {co.vatNumber && (
              <>
                <Text style={[S.footerLabel, { marginTop: 6 }]}>Momsreg. nr</Text>
                <Text style={S.footerValue}>{co.vatNumber}</Text>
              </>
            )}
            {bank?.fTax && <Text style={[S.footerValue, { marginTop: 6 }]}>Godkänd för F-skatt</Text>}
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<string> {
  // renderToBuffer is @react-pdf's Node API; toBlob() is browser-oriented.
  const buffer = await renderToBuffer(<InvoiceDocument data={data} />);
  return Buffer.from(buffer).toString("base64");
}

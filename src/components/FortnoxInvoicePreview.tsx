import type { CSSProperties } from "react";

interface InvoiceRow {
  ArticleNumber?: string | null;
  Description?: string;
  DeliveredQuantity?: string | number | null;
  Price?: number | null;
  Sum?: number | null;
  VAT?: number;
  Unit?: string | null;
}

interface FortnoxInvoice {
  DocumentNumber?: string;
  InvoiceDate?: string;
  DueDate?: string;
  CustomerName?: string;
  CustomerNumber?: string | number;
  Address1?: string;
  ZipCode?: string;
  City?: string;
  Country?: string;
  YourReference?: string;
  OurReference?: string;
  TermsOfPayment?: string;
  Net?: number;
  TotalVAT?: number;
  Total?: number;
  OCR?: string;
  PenaltyInterest?: number;
  Currency?: string;
  InvoiceRows?: InvoiceRow[];
}

function fmt(n: number | string | null | undefined): string {
  if (n == null || n === "") return "0,00";
  return Number(n).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | null | undefined): string {
  return d ? d.slice(0, 10) : "-";
}

export function FortnoxInvoicePreview({
  invoice,
  invoiceId,
}: {
  invoice: FortnoxInvoice | null;
  invoiceId: string;
}) {
  const inv = invoice ?? {};
  const rows: InvoiceRow[] = inv.InvoiceRows ?? [];
  const net = Number(inv.Net ?? 0);
  const totalVat = Number(inv.TotalVAT ?? 0);
  const total = Number(inv.Total ?? 0);
  const currency = inv.Currency ?? "SEK";
  const paymentTerms = inv.TermsOfPayment ? `${inv.TermsOfPayment} dagar` : "30 dagar";
  const penaltyInterest = inv.PenaltyInterest != null ? `${inv.PenaltyInterest}%` : "8%";
  const docNumber = inv.DocumentNumber ?? invoiceId;
  const ocr = inv.OCR || docNumber;

  // Group VAT rows for the VAT summary at the bottom
  const vatSummary: Record<number, { base: number; vat: number }> = {};
  for (const row of rows) {
    if (row.Sum == null || !row.VAT) continue;
    const rate = Number(row.VAT);
    const base = Number(row.Sum);
    const vatAmt = base * (rate / 100);
    if (!vatSummary[rate]) vatSummary[rate] = { base: 0, vat: 0 };
    vatSummary[rate].base += base;
    vatSummary[rate].vat += vatAmt;
  }

  const page: CSSProperties = {
    fontFamily: "'Arial', 'Helvetica Neue', sans-serif",
    fontSize: "12px",
    lineHeight: "1.4",
    color: "#222",
    background: "#fff",
    width: "794px",
    minHeight: "1123px",
    padding: "52px 56px 48px",
    boxSizing: "border-box",
    position: "relative",
    display: "flex",
    flexDirection: "column",
  };

  const labelStyle: CSSProperties = { color: "#555", whiteSpace: "nowrap" };
  const cellPad: CSSProperties = { padding: "3px 0" };

  return (
    <div style={page}>
      {/* Page indicator */}
      <div style={{ position: "absolute", top: "18px", right: "56px", fontSize: "10px", color: "#888" }}>
        Sida 1(1)
      </div>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", marginBottom: "36px" }}>
        {/* Logo placeholder */}
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "50%",
            background: "#1b2b3a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ color: "#4ecdc4", fontWeight: "bold", fontSize: "13px", letterSpacing: "0.5px" }}>
            [S·R]
          </span>
        </div>

        {/* Title centred */}
        <div style={{ flex: 1, textAlign: "center", paddingTop: "8px" }}>
          <span style={{ fontWeight: "bold", fontSize: "20px", letterSpacing: "0.5px" }}>Faktura</span>
        </div>

        {/* Invoice meta */}
        <table style={{ borderCollapse: "collapse", fontSize: "12px" }}>
          <tbody>
            <tr>
              <td style={{ ...labelStyle, ...cellPad, paddingRight: "16px" }}>Fakturadatum</td>
              <td style={cellPad}>{fmtDate(inv.InvoiceDate)}</td>
            </tr>
            <tr>
              <td style={{ ...labelStyle, ...cellPad, paddingRight: "16px" }}>Fakturanr</td>
              <td style={cellPad}>{docNumber}</td>
            </tr>
            <tr>
              <td style={{ ...labelStyle, ...cellPad, paddingRight: "16px" }}>OCR</td>
              <td style={cellPad}>{ocr}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Customer address ── */}
      <div style={{ marginBottom: "28px" }}>
        {inv.CustomerName && <div style={{ marginBottom: "2px" }}>{inv.CustomerName}</div>}
        {inv.Address1 && <div style={{ marginBottom: "2px" }}>{inv.Address1}</div>}
        {(inv.ZipCode || inv.City) && (
          <div style={{ marginBottom: "2px" }}>
            {[inv.ZipCode, inv.City].filter(Boolean).join(" ")}
          </div>
        )}
        {inv.Country && <div>{inv.Country}</div>}
      </div>

      {/* ── References ── */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td style={{ ...labelStyle, ...cellPad, paddingRight: "20px" }}>Kundnr</td>
              <td style={cellPad}>{inv.CustomerNumber ?? "-"}</td>
            </tr>
            <tr>
              <td style={{ ...labelStyle, ...cellPad, paddingRight: "20px" }}>Er referens</td>
              <td style={cellPad}>{inv.YourReference || "-"}</td>
            </tr>
          </tbody>
        </table>

        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td style={{ ...labelStyle, ...cellPad, paddingRight: "20px" }}>Vår referens</td>
              <td style={cellPad}>{inv.OurReference || "-"}</td>
            </tr>
            <tr>
              <td style={{ ...labelStyle, ...cellPad, paddingRight: "20px" }}>Betalningsvillkor</td>
              <td style={cellPad}>{paymentTerms}</td>
            </tr>
            <tr>
              <td style={{ ...labelStyle, ...cellPad, paddingRight: "20px" }}>Förfallodatum</td>
              <td style={cellPad}>{fmtDate(inv.DueDate)}</td>
            </tr>
            <tr>
              <td style={{ ...labelStyle, ...cellPad, paddingRight: "20px" }}>Dröjsmålsränta</td>
              <td style={cellPad}>{penaltyInterest}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Line items ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "0" }}>
        <thead>
          <tr style={{ borderTop: "1px solid #ccc", borderBottom: "1px solid #ccc" }}>
            {(["Artnr", "Benämning", "Lev ant", "À-pris", "Summa"] as const).map((h, idx) => (
              <th
                key={h}
                style={{
                  padding: "6px 4px",
                  fontWeight: "normal",
                  color: "#555",
                  fontSize: "11px",
                  textAlign: idx === 0 || idx === 1 ? "left" : "right",
                  width: idx === 0 ? "60px" : idx === 1 ? "auto" : "90px",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isHeaderRow =
              (row.ArticleNumber == null || row.ArticleNumber === "") &&
              (row.DeliveredQuantity == null || row.DeliveredQuantity === "") &&
              (row.Price == null || row.Price === 0) &&
              (row.Sum == null || row.Sum === 0);

            return (
              <tr key={i}>
                <td style={{ padding: "5px 4px", verticalAlign: "top" }}>
                  {!isHeaderRow ? row.ArticleNumber ?? "" : ""}
                </td>
                <td style={{ padding: "5px 4px", verticalAlign: "top" }}>{row.Description ?? ""}</td>
                <td style={{ padding: "5px 4px", textAlign: "right", verticalAlign: "top" }}>
                  {!isHeaderRow && row.DeliveredQuantity != null ? fmt(row.DeliveredQuantity) : ""}
                </td>
                <td style={{ padding: "5px 4px", textAlign: "right", verticalAlign: "top" }}>
                  {!isHeaderRow && row.Price != null ? fmt(row.Price) : ""}
                </td>
                <td style={{ padding: "5px 4px", textAlign: "right", verticalAlign: "top" }}>
                  {!isHeaderRow && row.Sum != null ? fmt(row.Sum) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Spacer — flex:1 fills all remaining space so totals always pin to the bottom */}
      <div style={{ flex: 1 }} />

      {/* ── Totals ── */}
      <div style={{ borderTop: "1px solid #ccc", paddingTop: "10px", marginBottom: "6px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          {/* Left: excl/VAT/total columns */}
          <div style={{ display: "flex", gap: "40px" }}>
            <div>
              <div style={{ color: "#555", fontSize: "10px", marginBottom: "2px" }}>Exkl. moms</div>
              <div>{fmt(net)}</div>
            </div>
            <div>
              <div style={{ color: "#555", fontSize: "10px", marginBottom: "2px" }}>Moms</div>
              <div>{fmt(totalVat)}</div>
            </div>
            <div>
              <div style={{ color: "#555", fontSize: "10px", marginBottom: "2px" }}>Totalt</div>
              <div>{fmt(total)}</div>
            </div>
          </div>

          {/* Right: ATT BETALA */}
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "#555", fontSize: "10px", marginBottom: "2px" }}>ATT BETALA</div>
            <div style={{ fontWeight: "bold", fontSize: "16px" }}>
              {currency} {fmt(total)}
            </div>
          </div>
        </div>
      </div>

      {/* VAT breakdown */}
      <div style={{ fontSize: "10px", color: "#666", marginBottom: "32px" }}>
        {Object.entries(vatSummary).map(([rate, { base, vat }]) => (
          <span key={rate}>
            Moms {rate}% {fmt(vat)} ({fmt(base)})
            {"  "}
          </span>
        ))}
      </div>

      {/* ── Footer ── */}
      <div style={{ borderTop: "1px solid #ccc", paddingTop: "10px" }}>
        <div style={{ display: "flex", gap: "40px", fontSize: "11px" }}>
          <div style={{ minWidth: "160px" }}>
            <div style={{ color: "#555", marginBottom: "2px" }}>Adress</div>
          </div>
          <div style={{ minWidth: "140px" }}>
            <div style={{ color: "#555", marginBottom: "2px" }}>Telefon</div>
            <div style={{ color: "#555", marginBottom: "2px", marginTop: "8px" }}>E-post</div>
          </div>
          <div style={{ minWidth: "80px" }}>
            <div style={{ color: "#555", marginBottom: "2px" }}>Clearingnr</div>
            <div style={{ color: "#555", marginBottom: "2px", marginTop: "8px" }}>Kontonr</div>
          </div>
          <div>
            <div style={{ color: "#555", marginBottom: "2px" }}>Organisationsnr</div>
          </div>
        </div>
      </div>
    </div>
  );
}

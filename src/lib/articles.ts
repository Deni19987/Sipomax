// Shared, client-safe types + helpers for article-based offers and invoices.
// Used by the offer composer, the invoice (faktura) page and the server layer.

export type ArticleLine = {
  // Fortnox ArticleNumber, or null for a manually entered ("egen rad") line.
  article_number: string | null;
  description: string;
  quantity: number;
  // Unit price excluding VAT. Editable per offer/invoice (temporary price).
  unit_price: number;
  // VAT percentage (Sweden defaults to 25).
  vat: number | null;
};

export function lineSubtotal(line: { quantity: number; unit_price: number }): number {
  const qty = Number(line.quantity) || 0;
  const price = Number(line.unit_price) || 0;
  return qty * price;
}

export function articlesSubtotal(lines: Array<{ quantity: number; unit_price: number }>): number {
  return lines.reduce((sum, line) => sum + lineSubtotal(line), 0);
}

// Coerce an arbitrary stored/aggregated record into a well-formed ArticleLine.
export function normalizeArticleLine(raw: any): ArticleLine {
  return {
    article_number:
      raw?.article_number != null && String(raw.article_number).trim() !== ""
        ? String(raw.article_number)
        : null,
    description: String(raw?.description ?? ""),
    quantity: Number(raw?.quantity) > 0 ? Number(raw.quantity) : 1,
    unit_price: Number(raw?.unit_price) >= 0 ? Number(raw.unit_price) : 0,
    vat: raw?.vat != null ? Number(raw.vat) : 25,
  };
}

export function formatSek(amount: number): string {
  return amount.toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Pure, dependency-free customer matching + ranking shared by the client
// dropdowns and the server-side cache search so both behave identically.

export interface MatchableCustomer {
  customerNumber: string;
  name?: string;
  /** Personal first+last name stored separately when official name is a company name */
  personalName?: string;
  email?: string;
  phone?: string;
  orgNumber?: string;
  address?: string;
  city?: string;
}

function digitsOnly(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

// Returns a relevance score: 0 = no match, higher = better.
//
// For single-token queries all tokens must match (strict). For multi-token
// queries (names with middle names, etc.) at least 2 tokens must match a
// name field — order-independent — so "Johan Thorsten Runow" finds "Johan Runow".
// Non-name fields (email, phone, org, address) still require all tokens to match.
export function scoreCustomer(c: MatchableCustomer, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;

  const name = (c.name ?? "").toLowerCase();
  const personal = (c.personalName ?? "").toLowerCase();
  const num = String(c.customerNumber ?? "").toLowerCase();
  const email = (c.email ?? "").toLowerCase();
  const org = digitsOnly(c.orgNumber ?? "");
  const addr = (c.address ?? "").toLowerCase();
  const city = (c.city ?? "").toLowerCase();
  const phone = digitsOnly(c.phone ?? "");

  const tokens = q.split(/\s+/).filter(Boolean);

  function tokenHitsName(t: string): boolean {
    return name.includes(t) || personal.includes(t);
  }
  function tokenHitsOther(t: string): boolean {
    const td = digitsOnly(t);
    if ([num, email, addr, city].some((f) => f.includes(t))) return true;
    if (td.length >= 3 && (phone.includes(td) || org.includes(td))) return true;
    return false;
  }

  const nameHits = tokens.filter(tokenHitsName).length;
  const otherHits = tokens.filter(tokenHitsOther).length;

  // Require at least 2 name-token hits for multi-word queries, or all tokens
  // via other fields, or a single token that hits anywhere.
  const minNameHits = tokens.length >= 2 ? 2 : 1;
  const nameMatch = nameHits >= minNameHits;
  const otherMatch = otherHits === tokens.length;
  if (!nameMatch && !otherMatch) return 0;

  if (!nameMatch) return 30; // matched only via email/phone/org/address

  // Score by match quality against official name first, then personal name.
  const allInName = tokens.every((t) => name.includes(t));
  const allInPersonal = tokens.every((t) => personal.includes(t));

  if (name === q) return 100;
  if (name.startsWith(q)) return 90;
  if (name.includes(q)) return 80;
  if (allInName) return 70;
  // Partial name match — penalise by fraction of unmatched tokens
  const nameFraction = nameHits / tokens.length;
  if (name && nameHits > 0 && !allInPersonal) return Math.round(45 + nameFraction * 20);
  // Match via personal name (customer registered under company name)
  if (personal === q) return 45;
  if (personal.startsWith(q)) return 42;
  if (allInPersonal) return 40;
  return Math.round(30 + (nameHits / tokens.length) * 10);
}

export interface MatchableArticle {
  articleNumber: string;
  description?: string;
}

// Relevance score for an article against a (possibly multi-word) query.
export function scoreArticle(a: MatchableArticle, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const num = (a.articleNumber ?? "").toLowerCase();
  const desc = (a.description ?? "").toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const everyTokenMatches = tokens.every((t) => num.includes(t) || desc.includes(t));
  if (!everyTokenMatches) return 0;
  if (num === q) return 100;
  if (num.startsWith(q)) return 90;
  if (desc.startsWith(q)) return 85;
  if (num.includes(q)) return 75;
  if (desc.includes(q)) return 70;
  if (tokens.every((t) => desc.includes(t))) return 60;
  return 30;
}

export function rankArticles<T extends MatchableArticle>(
  list: T[],
  query: string,
  recentOrder: string[],
): T[] {
  const recentRank = new Map(recentOrder.map((n, i) => [n, i]));
  return list
    .map((a) => ({ a, score: scoreArticle(a, query) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      const rx = recentRank.has(x.a.articleNumber) ? recentRank.get(x.a.articleNumber)! : Infinity;
      const ry = recentRank.has(y.a.articleNumber) ? recentRank.get(y.a.articleNumber)! : Infinity;
      return rx - ry;
    })
    .map((x) => x.a);
}

// Sort matched customers by score (desc), using the caller-supplied recency
// rank only as a tiebreak between equally-scored customers.
export function rankCustomers<T extends MatchableCustomer>(
  list: T[],
  query: string,
  recentOrder: string[],
): T[] {
  const recentRank = new Map(recentOrder.map((n, i) => [n, i]));
  return list
    .map((c) => ({ c, score: scoreCustomer(c, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ra = recentRank.has(a.c.customerNumber) ? recentRank.get(a.c.customerNumber)! : Infinity;
      const rb = recentRank.has(b.c.customerNumber) ? recentRank.get(b.c.customerNumber)! : Infinity;
      return ra - rb;
    })
    .map((x) => x.c);
}

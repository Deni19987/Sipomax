// Delade typer och textformat för verkstadschatten (allmän kanal + ordertrådar).
// Datat bor i backend-tabellen workshop_messages.

export const GENERAL_THREAD = "allmant";

export type ChatMessage = {
  id: string;
  orderId: string | null;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  mentions: string[];
  orderRefs: string[];
  // Sätts bara lokalt medan meddelandet är på väg till servern.
  optimistic?: boolean;
};

export type ChatThread = {
  orderId: string | null; // null = allmän kanal
  title: string;
  subtitle: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  unreadCount: number;
  mentionsMe: boolean;
};

export type WorkshopMember = {
  id: string;
  name: string;
  email: string | null;
};

export type OrderRef = {
  id: string;
  orderNumber: number;
  customerName: string | null;
  status: string;
};

// Meddelanden lagras med inline-taggar så att både namn och id följer med:
//   @[Anna Svensson](<user-uuid>)  och  #[1042](<order-uuid>)
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const TOKEN_RE = new RegExp(`([@#])\\[([^\\]\\n]{1,80})\\]\\((${UUID})\\)`, "g");

// Query-nyckel/tabellnyckel för en tråd: 'allmant' eller order-id.
export function chatThreadKey(orderId: string | null): string {
  return orderId ?? GENERAL_THREAD;
}

// Klockslag för dagens meddelanden, datum + tid för äldre.
export function formatChatTime(iso: string): string {
  const date = new Date(iso);
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday
    ? date.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("sv-SE", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export type ChatSegment =
  | { type: "text"; text: string }
  | { type: "mention"; label: string; userId: string }
  | { type: "order"; label: string; orderId: string };

export function parseChatBody(body: string): ChatSegment[] {
  const segments: ChatSegment[] = [];
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let match = TOKEN_RE.exec(body);
  while (match) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", text: body.slice(lastIndex, match.index) });
    }
    const [, sigil, label, id] = match;
    segments.push(
      sigil === "@"
        ? { type: "mention", label, userId: id }
        : { type: "order", label, orderId: id },
    );
    lastIndex = match.index + match[0].length;
    match = TOKEN_RE.exec(body);
  }
  if (lastIndex < body.length) segments.push({ type: "text", text: body.slice(lastIndex) });
  return segments;
}

// Läsbar text utan id:n — används i trådlistans förhandsvisning och i notiser.
export function plainChatBody(body: string): string {
  return body.replace(TOKEN_RE, (_all, sigil: string, label: string) => `${sigil}${label}`);
}

// Motsatsen till parseChatBody: tar den text användaren skrev ("@Anna kolla
// #1042") plus de val hen gjorde i väljaren och bygger taggarna. Varje val
// konsumerar första omatchade förekomsten av sin etikett, så en borttagen
// etikett tyst faller bort.
export function serializeChatBody(
  text: string,
  picks: Array<{ sigil: "@" | "#"; label: string; id: string }>,
): { body: string; mentions: string[]; orderRefs: string[] } {
  let body = text;
  const mentions: string[] = [];
  const orderRefs: string[] = [];

  for (const pick of picks) {
    const plain = `${pick.sigil}${pick.label}`;
    const index = body.indexOf(plain);
    if (index === -1) continue;
    body = `${body.slice(0, index)}${pick.sigil}[${pick.label}](${pick.id})${body.slice(
      index + plain.length,
    )}`;
    if (pick.sigil === "@") {
      if (!mentions.includes(pick.id)) mentions.push(pick.id);
    } else if (!orderRefs.includes(pick.id)) {
      orderRefs.push(pick.id);
    }
  }

  return { body, mentions, orderRefs };
}

// Hittar en pågående "@..."/"#..."-sökning direkt före markören i komponenten.
export function findActiveToken(
  text: string,
  caret: number,
): { sigil: "@" | "#"; query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)([@#])([^\s@#]{0,40})$/.exec(before);
  if (!match) return null;
  const sigil = match[2] as "@" | "#";
  return { sigil, query: match[3], start: caret - match[3].length - 1 };
}

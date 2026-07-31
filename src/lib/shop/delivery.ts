// Leveransuppgifter som kunden fyller i när beställningen läggs, och som kan
// sparas på kundkortet för att förifylla nästa gång.

export interface DeliveryDetails {
  /** Företag eller person som tar emot leveransen. */
  recipient: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  /** Telefon som fraktbolaget kan nå vid leverans. */
  phone: string;
  /** Fritext till verkstaden, t.ex. "Lastkaj på baksidan". */
  note: string;
}

export const EMPTY_DELIVERY: DeliveryDetails = {
  recipient: "",
  street: "",
  postalCode: "",
  city: "",
  country: "Sverige",
  phone: "",
  note: "",
};

// Fälten som måste vara ifyllda för att en beställning ska kunna skickas.
const REQUIRED: Array<{ key: keyof DeliveryDetails; label: string }> = [
  { key: "recipient", label: "Mottagare" },
  { key: "street", label: "Gatuadress" },
  { key: "postalCode", label: "Postnummer" },
  { key: "city", label: "Ort" },
  { key: "phone", label: "Telefonnummer" },
];

/** Returnerar fältnycklarna som saknas, i formulärets ordning. */
export function missingDeliveryFields(details: DeliveryDetails): Array<keyof DeliveryDetails> {
  return REQUIRED.filter((field) => !details[field.key]?.trim()).map((field) => field.key);
}

export function describeMissingFields(keys: Array<keyof DeliveryDetails>): string {
  const labels = keys.map((key) => REQUIRED.find((f) => f.key === key)?.label ?? key);
  if (labels.length === 1) return `${labels[0]} saknas.`;
  return `Fyll i ${labels.slice(0, -1).join(", ")} och ${labels[labels.length - 1]}.`;
}

export function isDeliveryComplete(details: DeliveryDetails): boolean {
  return missingDeliveryFields(details).length === 0;
}

/** Trimmar och normaliserar innan uppgifterna skickas till servern. */
export function normalizeDelivery(details: DeliveryDetails): DeliveryDetails {
  return {
    recipient: details.recipient.trim(),
    street: details.street.trim(),
    postalCode: details.postalCode.trim(),
    city: details.city.trim(),
    country: details.country.trim() || "Sverige",
    phone: details.phone.trim(),
    note: details.note.trim(),
  };
}

/** Adressen som läsbara rader, för kvitton och kundkortet. */
export function deliveryLines(details: DeliveryDetails): string[] {
  const postal = [details.postalCode, details.city].filter((p) => p.trim()).join(" ");
  return [details.recipient, details.street, postal, details.country]
    .map((line) => line.trim())
    .filter(Boolean);
}

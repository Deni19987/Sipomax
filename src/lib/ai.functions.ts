import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const INSUFFICIENT_MARKER = "OTILLRÄCKLIG_INFO";
const INSUFFICIENT_INSTRUCTION =
  "\n\nOM UNDERLAGET INTE RÄCKER:\n- Om statusuppdateringen och chattmeddelandena inte innehåller någon konkret arbetsuppgift, åtgärd eller relevant information som kan användas för att skapa en meningsfull kalenderanteckning för mekanikern — svara med ENDAST denna exakta sträng och inget annat: " +
  INSUFFICIENT_MARKER +
  "\n- Hitta hellre på ingenting alls och returnera markören än att gissa.";
const INSUFFICIENT_ERROR_SV =
  "Otillräcklig information för att skapa en kalenderanteckning. Lägg till mer detaljer i statusuppdateringen eller chatten och försök igen.";

function isInsufficient(text: string): boolean {
  const t = text.trim().toUpperCase().replace(/[.!\s]+$/g, "");
  return t === INSUFFICIENT_MARKER || t.includes(INSUFFICIENT_MARKER);
}

const CALENDAR_TASK_GUIDANCE =
  "\n\nSå här formulerar du ATT GÖRA:\n- VARJE rad under ATT GÖRA måste börja med ett verb i imperativ form (kontrollera, byt, åtgärda, felsök, montera, demontera, justera, fyll på, rengör, lufta, mät, provkör, beställ osv.). Inga substantiveringar, inga hela meningar, ingen tidsangivelse, ingen prisinfo.\n- Översätt statusuppdateringens beskrivning till själva uppgiften (\"Vi har påbörjat kontrollen av kamremmen\" → \"Kontrollera kamrem\").\n- Om flera arbeten nämns, lista dem som separata rader med bindestreck. Annars en enda rad utan bindestreck.\n- Använd bara arbeten som faktiskt nämns i statusuppdateringen eller chattmeddelandena. Hitta inte på extra moment.\n- ALLT annat som inte är en uppgift — observationer, beslut, väntan på delar, kommentarer, fynd som inte ska åtgärdas, leveranstider, kunders frågor — får INTE stå under ATT GÖRA. Sätt det under en tredje rubrik ÖVRIG INFO i stället.\n\nValfri tredje rubrik ÖVRIG INFO:\n- Lägg endast till ÖVRIG INFO om det finns relevant information som inte är en uppgift och inte är kommunicerat till kunden (det sistnämnda hör under KONTEXT).\n- Skriv den efter KONTEXT (eller efter ATT GÖRA om KONTEXT saknas). Om det inte finns något — utelämna rubriken helt.\n\nExempel:\n\nStatusuppdatering: \"Vi har påbörjat kontrollen av din kamrem.\"\nATT GÖRA:\nKontrollera kamrem\n\nStatusuppdatering: \"Bytt bromsbelägg fram, ska även byta bromsskivor bak och kontrollera bromsvätskan.\"\nATT GÖRA:\n- Byt bromsskivor bak\n- Kontrollera bromsvätska\n\nStatusuppdatering: \"Hittade läckage från servostyrningen vid felsökningen. Reservdel kommer på torsdag.\"\nChatt: \"Verkstad: Kunden har godkänt åtgärd av servostyrningsläckaget för max 4500 kr.\"\nATT GÖRA:\nÅtgärda läckage från servostyrning\n\nKONTEXT:\nKunden har godkänt åtgärd upp till 4500 kr.\n\nÖVRIG INFO:\nReservdel anländer på torsdag.";

const PROMPTS: Record<"calendar" | "customer_update", string> = {
  calendar:
    "Du skriver om verkstadens utkast till en kort kalenderhändelse-beskrivning för en mekaniker.\n\nABSOLUT VIKTIGAST — INGEN HALLUCINATION:\n- Använd ENDAST information som finns ordagrant i användarens utkast, i \"Statusuppdatering (kontext)\" och i \"Chattmeddelanden (kontext)\" om de finns med.\n- Plocka endast information från chatten som är direkt relaterad till just denna statusuppdatering.\n- Hitta ALDRIG på symptom, diagnoser, reservdelar, priser, tider, namn eller åtgärder.\n- Lägg aldrig till generella mekanikerråd eller fyllnadsfraser.\n\nUtdataformat — upp till tre rubriker i denna ordning, inga andra:\n\nATT GÖRA:\n<En eller flera arbetsuppgifter där VARJE rad börjar med ett verb i imperativ form. Om flera moment, lista som rader med bindestreck.>\n\nKONTEXT:\n<Specifik information som har kommunicerats till kunden i chatten och som är relevant för detta arbete. Hoppa över hela rubriken om inget specifikt kommunicerats.>\n\nÖVRIG INFO:\n<Övrig relevant info som inte är en uppgift och inte är kommunicerat till kunden — t.ex. fynd som inte ska åtgärdas, väntan på delar, leveranstider, interna kommentarer. Hoppa över hela rubriken om det inte finns något.>\n\nFormatregler:\n- Ren text. ANVÄND ALDRIG markdown (**, *, _, #, backticks) eller emojis.\n- Rubrikerna i VERSALER följt av kolon på egen rad, innehållet på raden under.\n- Tom rad mellan sektionerna.\n- Inga hälsningar, ingen signatur. Returnera ENDAST den färdiga beskrivningen." +
    CALENDAR_TASK_GUIDANCE +
    INSUFFICIENT_INSTRUCTION,
  customer_update:
    "You convert internal workshop notes into professional customer updates.\n\nThe input may contain short notes, typos, abbreviations and technical language.\n\nRules:\n- Rewrite into clear customer-facing language\n- Keep technical meaning unchanged\n- Do not invent findings, prices or timelines\n- If notes are unclear, say additional inspection is ongoing\n- Return only the final update\n\nExamples:\n\nINPUT:\n\"bromsar slut bak. skivor d\u00e5liga. beh\u00f6ver bytas. inv\u00e4ntar ok fr\u00e5n leverant\u00f6r\"\n\nOUTPUT:\nVi har kontrollerat bromssystemet och konstaterat att de bakre bromsarna \u00e4r slitna och att bromsskivorna beh\u00f6ver bytas.\n\nVi inv\u00e4ntar f\u00f6r n\u00e4rvarande delar fr\u00e5n leverant\u00f6ren innan arbetet kan forts\u00e4tta.\n\nINPUT:\n\"olja + filter klart. hittade sprucken damask h\u00f6 fram\"\n\nOUTPUT:\nServicen med olja och filter \u00e4r nu genomf\u00f6rd.\n\nVid kontroll uppt\u00e4ckte vi \u00e4ven en skadad damask fram h\u00f6ger som kan beh\u00f6va \u00e5tg\u00e4rdas. Vi rekommenderar vidare kontroll innan fortsatt arbete.\n\nINPUT:\n\"fels\u00f6kt missljud. verkar hjullager vf\"\n\nOUTPUT:\nVi har genomf\u00f6rt fels\u00f6kning av det rapporterade missljudet.\n\nDen initiala kontrollen tyder p\u00e5 att problemet kan vara relaterat till hjullagret fram v\u00e4nster. Vid behov kan ytterligare kontroll beh\u00f6vas f\u00f6r att bekr\u00e4fta orsaken.",
};

const CALENDAR_REVIEW_PROMPT =
  "Du är granskare. Du får ett utkast till en kalenderhändelse-beskrivning för en mekaniker på svenska, samt den ursprungliga källtexten (utkast, statusuppdatering och eventuella chattmeddelanden).\n\nDin uppgift:\n1. Säkerställ att utkastet bara innehåller högst tre rubriker, i denna ordning: ATT GÖRA (alltid), KONTEXT (endast om något specifikt har kommunicerats till kunden) och ÖVRIG INFO (endast om det finns relevant info som varken är en uppgift eller kommunicerat till kunden). Inga andra rubriker får finnas.\n2. Kontrollera att VARJE rad under ATT GÖRA börjar med ett verb i imperativ form (kontrollera, byt, åtgärda, felsök, justera, montera, demontera, fyll på, lufta, mät, provkör, beställ osv.). Om en rad inte är imperativ, antingen omformulera den till en imperativ uppgift (om det är en faktisk uppgift) eller flytta innehållet till ÖVRIG INFO. Observationer, leveranstider, fynd som inte ska åtgärdas och liknande hör ALDRIG under ATT GÖRA.\n3. KONTEXT ska bara innehålla information som faktiskt kommunicerats till kunden och som är relevant. Om KONTEXT är tomt eller inte stöds av källan — ta bort hela rubriken.\n4. ÖVRIG INFO ska bara innehålla relevant information som inte är en uppgift och inte är kommunicerat till kunden. Om det inte finns något att skriva där — ta bort hela rubriken.\n5. Kontrollera att ALLT i utkastet faktiskt finns i källan. Ta bort meningar, detaljer eller påståenden som inte finns ordagrant i källan, även om de låter rimliga.\n6. Rätta stavfel och grammatikfel. Säkerställ att hela texten är på korrekt, naturlig svenska.\n7. Format: rubriker i VERSALER följt av kolon på egen rad, innehållet på raden under, tom rad mellan sektioner. ANVÄND ALDRIG markdown (**, *, _, #, backticks) eller emojis. Ingen hälsning, ingen signatur.\n8. Om utkastet är exakt strängen " + INSUFFICIENT_MARKER + " — returnera ENDAST " + INSUFFICIENT_MARKER + " och inget annat. Om källan saknar varje konkret arbetsuppgift eller relevant information och utkastet ändå försöker hitta på något — returnera ENDAST " + INSUFFICIENT_MARKER + ".\n\nReturnera ENDAST den slutgiltiga, rättade beskrivningen som ren text. Inga kommentarer om vad du ändrat.";

async function callAiChat(system: string, user: string): Promise<string> {
  const { callGemini } = await import("./ai-client.server");
  return callGemini(system, user);
}

async function reviewCalendarText(draft: string, source: string): Promise<string> {
  const userMsg =
    `KÄLLA (allt utkastet får baseras på):\n${source}\n\n` +
    `UTKAST ATT GRANSKA OCH RÄTTA:\n${draft}`;
  try {
    return await callAiChat(CALENDAR_REVIEW_PROMPT, userMsg);
  } catch {
    return draft;
  }
}

export const rewriteText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      text: z.string().min(1).max(8000),
      mode: z.enum(["calendar", "customer_update"]),
      context: z
        .object({
          status_label: z.string().max(200).optional().nullable(),
          description: z.string().max(4000).optional().nullable(),
          quote_amount: z.number().optional().nullable(),
          requires_approval: z.boolean().optional(),
          approval_state: z.string().max(40).optional().nullable(),
          attachment_count: z.number().int().min(0).max(999).optional(),
          attachment_names: z.array(z.string().max(200)).max(20).optional(),
          vehicle: z.string().max(200).optional().nullable(),
          registration_number: z.string().max(40).optional().nullable(),
          customer_name: z.string().max(200).optional().nullable(),
          created_at: z.string().max(60).optional().nullable(),
          messages: z
            .array(
              z.object({
                sender_type: z.enum(["workshop", "customer"]),
                body: z.string().max(4000),
                created_at: z.string().max(60).optional().nullable(),
              }),
            )
            .max(100)
            .optional(),
        })
        .optional()
        .nullable(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    let userContent = data.text;
    if (data.mode === "calendar" && data.context) {
      const c = data.context;
      const ctx: string[] = [];
      if (c.status_label) ctx.push(`Statustyp: ${c.status_label}`);
      if (c.registration_number) ctx.push(`Registreringsnummer: ${c.registration_number}`);
      if (c.vehicle) ctx.push(`Fordon: ${c.vehicle}`);
      if (c.customer_name) ctx.push(`Kund: ${c.customer_name}`);
      if (c.created_at) ctx.push(`Tidpunkt: ${c.created_at}`);
      if (c.quote_amount != null) ctx.push(`Offert: ${c.quote_amount} kr`);
      if (c.requires_approval) ctx.push(`Kräver kundgodkännande: ja (${c.approval_state ?? "pending"})`);
      if (c.attachment_count) {
        ctx.push(`Bilagor: ${c.attachment_count} st${c.attachment_names && c.attachment_names.length ? ` (${c.attachment_names.join(", ")})` : ""}`);
      }
      if (c.description) {
        ctx.push("");
        ctx.push("Anteckningar från verkstaden:");
        ctx.push(c.description);
      }
      const chat = formatMessages(c.messages);
      if (ctx.length) {
        userContent =
          `Utkast att skriva om (din primära källa):\n${data.text}\n\n` +
          `Statusuppdatering (kontext — använd ENDAST om det gör kalenderhändelsen mer användbar, hitta inget på):\n${ctx.join("\n")}` +
          (chat ? `\n\nChattmeddelanden (kontext — använd endast det som är direkt relaterat till denna statusuppdatering):\n${chat}` : "");
      }
    }

    const out = await callAiChat(PROMPTS[data.mode], userContent);
    if (data.mode === "calendar") {
      if (isInsufficient(out)) throw new Error(INSUFFICIENT_ERROR_SV);
      const reviewed = await reviewCalendarText(out, userContent);
      if (isInsufficient(reviewed)) throw new Error(INSUFFICIENT_ERROR_SV);
      return { text: stripMarkdown(reviewed) };
    }
    return { text: out };
  });

const CALENDAR_GENERATE_PROMPT =
  "Du skapar en kort kalenderhändelse-beskrivning åt en mekaniker baserat på en statusuppdatering och eventuella chattmeddelanden mellan verkstaden och kunden.\n\nABSOLUT VIKTIGAST — INGEN HALLUCINATION:\n- Använd ENDAST information som finns ordagrant i indatan nedan (statusuppdatering + chattmeddelanden).\n- Plocka endast information från chatten som är direkt relaterad till just denna statusuppdatering.\n- Hitta ALDRIG på symptom, diagnoser, reservdelar, priser, tider, namn eller åtgärder. Inga generella råd, inga antaganden.\n\nUtdataformat — upp till tre rubriker i denna ordning, inga andra:\n\nATT GÖRA:\n<En eller flera arbetsuppgifter där VARJE rad börjar med ett verb i imperativ form. Om flera moment, lista som rader med bindestreck.>\n\nKONTEXT:\n<Specifik information som har kommunicerats till kunden i chattmeddelandena och som är relevant för detta arbete. Hoppa över hela rubriken om inget specifikt kommunicerats.>\n\nÖVRIG INFO:\n<Övrig relevant info som varken är en uppgift eller kommunicerat till kunden — t.ex. fynd som inte ska åtgärdas, väntan på delar, leveranstider, interna kommentarer. Hoppa över hela rubriken om det inte finns något.>\n\nFormatregler:\n- Ren text. ANVÄND ALDRIG markdown (**, *, _, #, backticks) eller emojis.\n- Rubrikerna i VERSALER följt av kolon på egen rad, innehållet på raden under.\n- Tom rad mellan sektionerna.\n- Inga hälsningar, ingen signatur. Returnera ENDAST den färdiga beskrivningen." +
  CALENDAR_TASK_GUIDANCE +
  INSUFFICIENT_INSTRUCTION;

function formatMessages(
  messages?: Array<{ sender_type: "workshop" | "customer"; body: string; created_at?: string | null }> | null,
): string {
  if (!messages || messages.length === 0) return "";
  return messages
    .slice(-40)
    .map((m) => {
      const who = m.sender_type === "workshop" ? "Verkstad" : "Kund";
      const when = m.created_at ? ` (${m.created_at})` : "";
      return `${who}${when}: ${m.body}`;
    })
    .join("\n");
}

export const generateCalendarText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      context: z.object({
        status_label: z.string().max(200),
        description: z.string().max(4000).optional().nullable(),
        quote_amount: z.number().optional().nullable(),
        requires_approval: z.boolean().optional(),
        approval_state: z.string().max(40).optional().nullable(),
        attachment_count: z.number().int().min(0).max(999).optional(),
        attachment_names: z.array(z.string().max(200)).max(20).optional(),
        vehicle: z.string().max(200).optional().nullable(),
        registration_number: z.string().max(40).optional().nullable(),
        customer_name: z.string().max(200).optional().nullable(),
        created_at: z.string().max(60).optional().nullable(),
        messages: z
          .array(
            z.object({
              sender_type: z.enum(["workshop", "customer"]),
              body: z.string().max(4000),
              created_at: z.string().max(60).optional().nullable(),
            }),
          )
          .max(100)
          .optional(),
      }),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const c = data.context;
    const lines: string[] = [];
    lines.push(`Statustyp: ${c.status_label}`);
    if (c.registration_number) lines.push(`Registreringsnummer: ${c.registration_number}`);
    if (c.vehicle) lines.push(`Fordon: ${c.vehicle}`);
    if (c.customer_name) lines.push(`Kund: ${c.customer_name}`);
    if (c.created_at) lines.push(`Tidpunkt: ${c.created_at}`);
    if (c.quote_amount != null) lines.push(`Offert: ${c.quote_amount} kr`);
    if (c.requires_approval) lines.push(`Kräver kundgodkännande: ja (${c.approval_state ?? "pending"})`);
    if (c.attachment_count) {
      lines.push(`Bilagor: ${c.attachment_count} st${c.attachment_names && c.attachment_names.length ? ` (${c.attachment_names.join(", ")})` : ""}`);
    }
    if (c.description) {
      lines.push("");
      lines.push("Anteckningar från verkstaden:");
      lines.push(c.description);
    }
    const chat = formatMessages(c.messages);
    if (chat) {
      lines.push("");
      lines.push("Chattmeddelanden (använd endast det som är direkt relaterat till denna statusuppdatering):");
      lines.push(chat);
    }

    const source = lines.join("\n");
    const out = await callAiChat(CALENDAR_GENERATE_PROMPT, source);
    if (isInsufficient(out)) throw new Error(INSUFFICIENT_ERROR_SV);
    const reviewed = await reviewCalendarText(out, source);
    if (isInsufficient(reviewed)) throw new Error(INSUFFICIENT_ERROR_SV);
    return { text: stripMarkdown(reviewed) };
  });

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

const VOICE_TO_SMS_PROMPT =
  "Du analyserar en röstinspelning från verkstadsägaren och skriver ett textmeddelande till kunden baserat på informationen i inspelningen. Skriv i sms-stil: informellt, flytande text, inga punktlistor, inga rubriker. Undvik att låta som en AI. Hitta aldrig på information som inte finns i inspelningen — omformulera bara det som sägs till ett naturligt sms. Använd tidigare meddelanden i chatten som kontext för ton och vad som redan sagts, men upprepa inte det som kunden redan vet. Skriv alltid med korrekt meningsstruktur: fixa grammatikfel, och ta bort ofullständiga meningar så att texten blir tydlig och välformulerad. Returnera endast själva meddelandetexten, utan hälsningsfraser om det inte är naturligt, utan signatur, utan citattecken.";

const REWRITE_SMS_PROMPT =
  "Du får ett utkast till ett sms från verkstaden till kunden. Din uppgift är att förbättra texten utan att ändra innebörden. Läs utkastet kritiskt: kontrollera att du verkligen har förstått innebörden rätt från den ursprungliga röstinspelningen. Om något verkar feltolkat, oklart eller konstigt formulerat, rätta till det. Detta är en helt ny omskrivning — gå tillbaka till grunden och tillämpa alla regler färskt varje gång, inte bara finjustera föregående version. Viktigaste reglerna: lägg ALDRIG till information som inte redan finns i utkastet — du får inte hitta på detaljer, priser, tider eller åtgärder. Ta bort ofullständiga meningar. Fixa alla grammatikfel. Behåll texten så lik originalet som möjligt, men när det går — omarrangera meningar så att budskapet blir så lättläst och professionellt som möjligt. Skriv fortfarande i sms-stil: informellt, flytande text, inga punktlistor, inga rubriker. Undvik att låta som en AI. Använd tidigare meddelanden i chatten endast som kontext för ton, upprepa inte det som redan sagts. Returnera endast den färdiga meddelandetexten — utan citattecken, utan signatur, utan kommentarer.";

const FINETUNE_SMS_PROMPT =
  "Du får ett sms-utkast från verkstaden till kunden. Gör ENDAST en lätt finjustering — ändra så lite som möjligt. Behåll meningarnas ordning, ordval och struktur i största möjliga mån. Justera bara små saker: stavfel, uppenbara grammatikfel, missade mellanslag, lite mjukare flyt. Skriv inte om texten, omformulera inte hela meningar, ändra inte tonen. Lägg ALDRIG till ny information som inte redan finns i utkastet. Behåll sms-stilen: informellt, flytande text, inga punktlistor, inga rubriker. Returnera endast den färdiga meddelandetexten — utan citattecken, utan signatur, utan kommentarer.";

export const rewriteSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      text: z.string().min(1).max(4000),
      mode: z.enum(["rewrite", "finetune"]).optional(),
      history: z
        .array(
          z.object({
            sender_type: z.enum(["workshop", "customer"]),
            body: z.string().max(4000),
          }),
        )
        .max(50)
        .optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const historyText = (data.history ?? [])
      .slice(-20)
      .map((m) => `${m.sender_type === "workshop" ? "Verkstad" : "Kund"}: ${m.body}`)
      .join("\n");

    const userContent = historyText
      ? `Tidigare chatt (endast kontext):\n${historyText}\n\nUtkast att förbättra:\n${data.text}`
      : `Utkast att förbättra:\n${data.text}`;

    const systemPrompt = data.mode === "finetune" ? FINETUNE_SMS_PROMPT : REWRITE_SMS_PROMPT;
    const { callGemini } = await import("./ai-client.server");
    const out = await callGemini(systemPrompt, userContent);
    return { text: out };
  });

export const voiceToSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      audio_base64: z.string().min(10).max(15_000_000),
      mime_type: z.string().min(3).max(100),
      history: z
        .array(
          z.object({
            sender_type: z.enum(["workshop", "customer"]),
            body: z.string().max(4000),
          }),
        )
        .max(50)
        .optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const historyText = (data.history ?? [])
      .slice(-20)
      .map((m) => `${m.sender_type === "workshop" ? "Verkstad" : "Kund"}: ${m.body}`)
      .join("\n");

    const textPrompt = historyText
      ? `Tidigare chatt mellan verkstad och kund (kontext):\n${historyText}\n\nSkriv nu ett nytt sms till kunden baserat på röstinspelningen ovan.`
      : "Skriv ett sms till kunden baserat på röstinspelningen.";

    const { callGeminiWithAudio } = await import("./ai-client.server");
    const out = await callGeminiWithAudio(VOICE_TO_SMS_PROMPT, data.audio_base64, data.mime_type, textPrompt);
    return { text: out };
  });
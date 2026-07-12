import { GoogleGenerativeAI } from "@google/generative-ai";

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (GEMINI_API_KEY missing)");
  return new GoogleGenerativeAI(apiKey);
}

export async function callGemini(
  systemPrompt: string,
  userContent: string,
  jsonMode = false,
): Promise<string> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemPrompt,
    generationConfig: jsonMode ? { responseMimeType: "application/json" } : undefined,
  });
  const result = await model.generateContent(userContent);
  const text = result.response.text().trim();
  if (!text) throw new Error("AI returned an empty response");
  return text;
}

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent([
    {
      inlineData: {
        data: audioBase64,
        mimeType: mimeType as Parameters<typeof model.generateContent>[0] extends (infer T)[] ? never : never,
      },
    } as { inlineData: { data: string; mimeType: string } },
    "Transkribera det talade innehållet i denna ljudfil. Returnera endast transkriptionen, ingen annan text.",
  ]);
  return result.response.text().trim();
}

export async function callGeminiWithAudio(
  systemPrompt: string,
  audioBase64: string,
  mimeType: string,
  textPrompt: string,
): Promise<string> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemPrompt,
  });
  const result = await model.generateContent([
    { inlineData: { data: audioBase64, mimeType } } as { inlineData: { data: string; mimeType: string } },
    textPrompt,
  ]);
  const text = result.response.text().trim();
  if (!text) throw new Error("AI returned an empty response");
  return text;
}

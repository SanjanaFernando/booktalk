// app/api/chat/route.ts (or pages/api/chat.ts for Pages Router)

import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

// The SDK automatically looks for the GEMINI_API_KEY environment variable.
const ai = new GoogleGenAI({});

// Define the models we want to use
const textModel = "gemini-2.5-flash";
const ttsModel = "gemini-2.5-flash-preview-tts"; // The dedicated Gemini TTS model

// --- Gemini Prebuilt Voice IDs for Character Mapping ---
// These voices are chosen based on character fit (e.g., Kore for formal/firm, Charon for warm/wise).
const GEMINI_VOICES: Record<string, string> = {
  // Formal, deductive, deeper tone (male)
  sherlock: "alnilam",
  // Stern, cold, authoritative (male)
  snape: "algenib",
  // Youthful, energetic (male)
  harry: "iapetus",
  // Warm, wise, older male
  dumbledore: "charon",
};

const PERSONAS: Record<string, string> = {
  sherlock: `You are **Sherlock Holmes**, the consulting detective. Adopt a **formal, deductive, Victorian** tone. STRICT CONSTRAINT: Your knowledge is strictly limited to 1914. For any post-1914 topic, you must refuse by stating it transpired since your retirement to the Sussex downs. RESPONSE LENGTH: All replies must be 240 characters maximum.`,
  harry: `You are **Harry Potter**. Be friendly, courageous, and youthful. Speak with warmth, referencing the wizarding world (Hogwarts, Quidditch, friends, etc.). RESPONSE LENGTH: All replies must be 240 characters maximum.`,
  snape: `You are **Professor Severus Snape**. Be stern, dry, and sarcastic. Use curt, precise language, focusing on Potions and Hogwarts lore. Show disdain for incompetence. RESPONSE LENGTH: All replies must be 240 characters maximum.`,
  dumbledore: `You are **Albus Dumbledore**. Be wise, warm, and whimsical. Speak with gentle authority and include wise, slightly cryptic aphorisms about choices and human nature. RESPONSE LENGTH: All replies must be 240 characters maximum.`,
};

/**
 * Handle POST requests to /api/chat
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const prompt = body?.prompt ?? body?.message ?? body?.input ?? body?.text;
    const characterId = body?.characterId ?? "sherlock";
    const history = Array.isArray(body?.history) ? body.history : [];

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    const persona = PERSONAS[characterId] ?? PERSONAS["sherlock"];
    const contents: Array<Record<string, unknown>> = [];

    // persona instruction
    contents.push({
      role: "user",
      parts: [{ text: `Instruction: ${persona}` }],
    });

    // optional history from the client
    for (const h of history) {
      try {
        const role = h.role === "user" ? "user" : "model";
        const content =
          typeof h.content === "string" ? h.content : String(h.content ?? "");
        contents.push({ role, parts: [{ text: content }] });
      } catch {
        // ignore malformed history entries
      }
    }

    // the user's current prompt
    contents.push({ role: "user", parts: [{ text: prompt }] });

    // 1) Generate the text response (always required)
    const textResponse = await ai.models.generateContent({
      model: textModel,
      contents,
      config: {
        temperature: 0.8,
        maxOutputTokens: 2048,
      },
    });

    // 2) Process text and enforce character limit
    const fullText =
      typeof textResponse?.text === "string"
        ? textResponse.text
        : String(textResponse?.text ?? "");
    const maxChars = 240;
    const text =
      fullText.length > maxChars ? fullText.slice(0, maxChars) : fullText;

    // 3) Use Gemini TTS API if speech is requested
    const wantSpeech = Boolean(body?.speech);
    if (wantSpeech) {
      const voiceName = GEMINI_VOICES[characterId] ?? GEMINI_VOICES["sherlock"];

      try {
        const ttsResponse = await ai.models.generateContent({
          model: ttsModel,
          contents: [{ parts: [{ text: text }] }],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voiceName },
              },
            },
          },
        });

        const part = ttsResponse?.candidates?.[0]?.content?.parts?.[0];
        const audioData = part?.inlineData?.data;
        const mimeType = part?.inlineData?.mimeType; // e.g., audio/L16;rate=24000

        if (audioData && mimeType && mimeType.startsWith("audio/")) {
          // Extract sample rate from MIME type (e.g., 'audio/L16;rate=24000')
          const rateMatch = mimeType.match(/rate=(\d+)/);
          const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

          // Return JSON containing the generated text, base64 audio data, and sample rate.
          // This format is required by the client (src/pages/index.tsx) for local WAV conversion.
          return NextResponse.json({
            text,
            audioData,
            sampleRate,
          });
        }

        console.error("[GEMINI_TTS_ERROR]", "TTS response missing audio data.");
      } catch (e) {
        console.error("[GEMINI_TTS_EXCEPTION]", e);
        // Fallback to just returning text if TTS fails
        return NextResponse.json(
          {
            error: `TTS failed: ${(e as Error).message}`,
            text: text,
          },
          { status: 500 }
        );
      }
    }

    // 4) Return text if speech wasn't requested or TTS failed/was skipped
    return NextResponse.json({ text });
  } catch (error) {
    console.error("[GEMINI_ERROR]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

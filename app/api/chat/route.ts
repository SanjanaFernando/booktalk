// app/api/chat/route.ts (or pages/api/chat.ts for Pages Router)

import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

// Allow explicit API key fallback; if GEMINI_API_KEY is set use it, otherwise
// the SDK will attempt application-default credentials (GOOGLE_APPLICATION_CREDENTIALS).
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || undefined });

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
  sherlock: `You are **Sherlock Holmes**, the consulting detective. Adopt a **formal, deductive, Victorian** tone. STRICT CONSTRAINT: Your knowledge is strictly limited to 1914. For any post-1914 topic, you must refuse by stating it transpired since your retirement to the Sussex downs. RESPONSE LENGTH: All replies must be 140 characters maximum.`,
  harry: `You are **Harry Potter**. Be friendly, courageous, and youthful. Speak with warmth, referencing the wizarding world (Hogwarts, Quidditch, friends, etc.). RESPONSE LENGTH: All replies must be 140 characters maximum.`,
  snape: `You are **Professor Severus Snape**. Be stern, dry, and sarcastic. Use curt, precise language, focusing on Potions and Hogwarts lore. Show disdain for incompetence. RESPONSE LENGTH: All replies must be 140 characters maximum.`,
  dumbledore: `You are **Albus Dumbledore**. Be wise, warm, and whimsical. Speak with gentle authority and include wise, slightly cryptic aphorisms about choices and human nature. RESPONSE LENGTH: All replies must be 140 characters maximum.`,
};

/**
 * Handle POST requests to /api/chat
 */
export async function POST(req: Request) {
  try {
    // Quick sanity-check: log which credential file (if any) the server will use.
    try {
      const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (credPath) {
        const raw = fs.readFileSync(credPath, "utf8");
        try {
          const json = JSON.parse(raw);
          console.log(
            "Using service account:",
            json.client_email ?? "(no client_email in key)"
          );
        } catch {
          console.log(
            "GOOGLE_APPLICATION_CREDENTIALS file exists but could not be parsed as JSON:",
            credPath
          );
        }
      } else if (!process.env.GEMINI_API_KEY) {
        console.log(
          "No GEMINI_API_KEY and no GOOGLE_APPLICATION_CREDENTIALS set — requests will likely fail."
        );
      }
    } catch (e) {
      console.warn(
        "Could not read GOOGLE_APPLICATION_CREDENTIALS file:",
        (e as Error).message
      );
    }

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

    // 1) Generate the text response using the modern API surface.
    // Use the chat.generate endpoint so we can pass persona/history/messages.
    const chatMessages: Array<any> = [];
    // persona as a system message
    chatMessages.push({ role: "system", content: persona });
    for (const h of history) {
      const role = h.role === "user" ? "user" : "assistant";
      const content =
        typeof h.content === "string" ? h.content : String(h.content ?? "");
      chatMessages.push({ role, content });
    }
    chatMessages.push({ role: "user", content: prompt });

    let textResponse: any;
    try {
      const anyAi = ai as any;

      // Try several SDK surfaces depending on installed SDK version.
      if (anyAi.models?.chat?.generate) {
        textResponse = await anyAi.models.chat.generate({
          model: textModel,
          messages: chatMessages,
          temperature: 0.8,
          maxOutputTokens: 2048,
        });
      } else if (anyAi.models?.text?.generate) {
        // Some SDK versions provide a text.generate surface that accepts a single input string.
        const inputText = [
          persona,
          ...history.map((h: any) => String(h.content ?? "")),
          prompt,
        ].join("\n");
        textResponse = await anyAi.models.text.generate({
          model: textModel,
          input: inputText,
          temperature: 0.8,
          maxOutputTokens: 2048,
        });
      } else if (anyAi.models?.generateContent) {
        // Older SDK surface used generateContent with structured 'contents'.
        textResponse = await anyAi.models.generateContent({
          model: textModel,
          contents,
          config: { temperature: 0.8, maxOutputTokens: 2048 },
        });
      } else if (anyAi.models?.generate) {
        // Generic fallback - try generate with prompt
        textResponse = await anyAi.models.generate({
          model: textModel,
          input: prompt,
        });
      } else {
        throw new Error(
          "No supported generate method found on @google/genai client. Please check installed SDK version."
        );
      }
    } catch (err) {
      console.error("[GEMINI_ERROR] text generation failed:", err);
      const message = (err as any)?.message ?? String(err);
      return NextResponse.json(
        { error: "Model generation failed", detail: message },
        { status: 500 }
      );
    }

    // 2) Process text and enforce character limit
    // Try several common response shapes used by GenAI SDKs.
    const fullText =
      // chat.generate -> choices[0].message.content or output[0].content
      (textResponse?.choices?.[0]?.message?.content?.[0]?.text as string) ||
      (textResponse?.output?.[0]?.content?.[0]?.text as string) ||
      (textResponse?.text as string) ||
      String(textResponse ?? "");
    const maxChars = 240;
    const text =
      fullText.length > maxChars ? fullText.slice(0, maxChars) : fullText;

    // 3) Use Gemini TTS API if speech is requested
    const wantSpeech = Boolean(body?.speech);
    if (wantSpeech) {
      const voiceName = GEMINI_VOICES[characterId] ?? GEMINI_VOICES["sherlock"];

      try {
        // Generate TTS using the modern text.generate API if available. We request an audio modality
        // and ask for prebuilt voice selection. SDKs vary; try the text.generate surface first and
        // gracefully fall back if the shape differs.
        let ttsResponse: any;
        try {
          ttsResponse = await (ai as any).models.text.generate({
            model: ttsModel,
            input: text,
            // The SDK may accept 'responseModalities' or 'modalities' depending on version.
            responseModalities: ["AUDIO"],
            speechConfig: {
              voice: voiceName,
              // additional fields may be required by SDK; keep minimal and robust.
            },
          });
        } catch (e) {
          console.error("[GEMINI_TTS_EXCEPTION - text.generate]", e);
          return NextResponse.json(
            { error: `TTS failed: ${(e as Error).message}`, text },
            { status: 500 }
          );
        }

        // Attempt to extract audio from common response shapes.
        const candidatePart =
          ttsResponse?.output?.[0]?.content?.find(
            (c: any) => c.type === "audio"
          ) ||
          ttsResponse?.candidates?.[0]?.content?.parts?.[0] ||
          null;

        const audioData =
          candidatePart?.inlineData?.data || candidatePart?.data || null;
        const mimeType =
          candidatePart?.inlineData?.mimeType ||
          candidatePart?.mimeType ||
          "audio/L16;rate=24000";

        if (
          audioData &&
          typeof audioData === "string" &&
          mimeType &&
          mimeType.startsWith("audio/")
        ) {
          const rateMatch = mimeType.match(/rate=(\d+)/);
          const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
          return NextResponse.json(
            { text, audioData, sampleRate },
            { status: 200 }
          );
        }

        console.error(
          "[GEMINI_TTS_ERROR] TTS response missing audio data or different shape."
        );
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

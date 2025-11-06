// app/api/chat/route.ts (or pages/api/chat.ts for Pages Router)

import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

// The SDK automatically looks for the GEMINI_API_KEY environment variable.
// If you used the older @google/generative-ai package, it might have been GOOGLE_GEMINI_API_KEY
// The newer @google/genai package supports GEMINI_API_KEY.
const ai = new GoogleGenAI({});

// Define the model we want to use
const model = "gemini-2.5-flash";

/**
 * Handle POST requests to /api/chat
 */
export async function POST(req: Request) {
  try {
    // 1. Get the prompt from the request body
    // Accept either `prompt` (preferred) or legacy `message` field.
    const body = await req.json();
    const prompt = body?.prompt ?? body?.message ?? body?.input ?? body?.text;

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    // 2. Call the Gemini model
    const response = await ai.models.generateContent({
      model: model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      // Optional: Add generation settings here
      config: {
        temperature: 0.8,
        maxOutputTokens: 2048,
      },
    });

    // 3. Return the generated text
    return NextResponse.json({
      text: response.text,
    });
  } catch (error) {
    console.error("[GEMINI_ERROR]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

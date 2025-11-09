"use client";

import { useState } from "react";

// Message type
type Message = {
  id: string;
  role: "user" | "character";
  text: string;
  isStreaming?: boolean;
};

// --- Gemini TTS Utility Functions ---

/**
 * Converts a base64 encoded string to an ArrayBuffer.
 * @param base64 The base64 string
 * @returns An ArrayBuffer containing the decoded binary data.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Converts raw 16-bit PCM data (signed integers) into a playable WAV Blob.
 * The Gemini TTS API returns raw PCM data in the specified mimeType (e.g., audio/L16;rate=24000).
 * @param pcmData Int16Array of the raw audio data.
 * @param sampleRate The sample rate (e.g., 24000).
 * @returns A Blob containing the WAV file.
 */
function pcmToWav(pcmData: Int16Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitDepth = 16;
  const buffer = new ArrayBuffer(44 + pcmData.byteLength);
  const view = new DataView(buffer);
  let offset = 0;

  function writeString(s: string) {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
    offset += s.length;
  }

  function writeUint32(i: number) {
    view.setUint32(offset, i, true);
    offset += 4;
  }

  function writeUint16(i: number) {
    view.setUint16(offset, i, true);
    offset += 2;
  }

  // RIFF chunk descriptor
  writeString("RIFF");
  writeUint32(36 + pcmData.byteLength); // total size - 8
  writeString("WAVE");

  // fmt sub-chunk
  writeString("fmt ");
  writeUint32(16); // sub-chunk size
  writeUint16(1); // audio format (1 = PCM)
  writeUint16(numChannels);
  writeUint32(sampleRate);
  writeUint32(sampleRate * numChannels * (bitDepth / 8)); // byte rate
  writeUint16(numChannels * (bitDepth / 8)); // block align
  writeUint16(bitDepth); // bits per sample

  // data sub-chunk
  writeString("data");
  writeUint32(pcmData.byteLength); // data size

  // Write PCM data
  let dataOffset = offset;
  for (let i = 0; i < pcmData.length; i++) {
    view.setInt16(dataOffset + i * 2, pcmData[i], true);
  }

  return new Blob([view], { type: "audio/wav" });
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [characterId, setCharacterId] = useState<string>("sherlock");

  // Character definitions matching the server's voice mapping
  const characters = [
    { id: "sherlock", name: "Sherlock Holmes", voice: "Alnilum" },
    { id: "harry", name: "Harry Potter", voice: "Leda" },
    { id: "snape", name: "Professor Snape", voice: "algenib" },
    { id: "dumbledore", name: "Albus Dumbledore", voice: "Charon" },
  ];

  async function send() {
    if (!input) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      text: input,
    };

    const charMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: charMsgId, role: "character", text: "", isStreaming: true },
    ]);

    const messageToSend = input;
    setInput("");
    setLoading(true);

    // Build history for the API
    const history = messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    }));

    // Get selected voice from the dropdown (used by server for Gemini TTS)
    const selectedVoice =
      characters.find((c) => c.id === characterId)?.voice || "Kore";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: messageToSend,
          characterId,
          history,
          speech: true, // ask server to return Gemini TTS audio
          voice: selectedVoice,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === charMsgId
              ? { ...m, text: `Server error: ${text}`, isStreaming: false }
              : m
          )
        );
        setLoading(false);
        return;
      }

      // --- NEW LOGIC: Expecting JSON response with Base64 audio data ---
      const data = await res.json();
      const generatedText = data?.text || "Error: No text in response.";

      // Update UI with generated text
      setMessages((prev) =>
        prev.map((m) =>
          m.id === charMsgId
            ? { ...m, text: generatedText, isStreaming: false }
            : m
        )
      );

      // Process and play audio if included in the JSON response
      if (data.audioData && data.sampleRate) {
        try {
          // 1. Convert base64 string to ArrayBuffer
          const pcmBuffer = base64ToArrayBuffer(data.audioData);
          // 2. The API returns signed 16-bit PCM. Create Int16Array view.
          const pcm16 = new Int16Array(pcmBuffer);
          // 3. Convert raw PCM to a playable WAV Blob
          const wavBlob = pcmToWav(pcm16, data.sampleRate);
          // 4. Create object URL and play
          const audioUrl = URL.createObjectURL(wavBlob);
          const audio = new Audio(audioUrl);

          audio.play().catch((e) => console.warn("Audio play prevented:", e));

          // Clean up the object URL after audio finishes
          audio.onended = () => URL.revokeObjectURL(audioUrl);
        } catch (audioErr) {
          console.error("Error processing audio data:", audioErr);
        }
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === charMsgId
            ? { ...m, text: "Error contacting server.", isStreaming: false }
            : m
        )
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}
      className="font-sans"
    >
      <style jsx global>{`
        body {
          background: #f7f7f7;
          color: #333;
        }
        .font-sans {
          font-family: "Inter", sans-serif;
        }
        h1 {
          font-size: 2.2rem;
          font-weight: 700;
          color: #1a202c;
          border-bottom: 2px solid #ddd;
          padding-bottom: 0.5rem;
          margin-bottom: 1.5rem;
        }
        .chat-container {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1rem;
          border: 1px solid #e2e8f0;
          border-radius: 0.75rem;
          background: white;
          min-height: 400px;
          max-height: 60vh;
          overflow-y: auto;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1),
            0 2px 4px -2px rgba(0, 0, 0, 0.06);
          margin-bottom: 1rem;
        }
        .message {
          display: flex;
        }
        .user {
          justify-content: flex-end;
        }
        .character {
          justify-content: flex-start;
        }
        .messageInner {
          max-width: 80%;
          padding: 0.75rem 1rem;
          border-radius: 1.25rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          line-height: 1.5;
        }
        .user .messageInner {
          background-color: #3b82f6; /* Blue */
          color: white;
          border-bottom-right-radius: 0.25rem;
        }
        .character .messageInner {
          background-color: #e2e8f0; /* Light Gray */
          color: #1a202c;
          border-bottom-left-radius: 0.25rem;
        }
        .messageLabel {
          font-size: 0.75rem;
          font-weight: 600;
          opacity: 0.7;
          display: block;
          margin-bottom: 0.25rem;
        }
        .user .messageLabel {
          color: rgba(255, 255, 255, 0.9);
        }
        .character .messageLabel {
          color: #4a5568;
        }
        .streaming-cursor {
          display: inline-block;
          animation: blink 1s step-end infinite;
          font-weight: bold;
        }
        @keyframes blink {
          from,
          to {
            opacity: 1;
          }
          50% {
            opacity: 0;
          }
        }
        .chat-controls {
          display: flex;
          gap: 0.5rem;
        }
        .chat-controls input {
          flex-grow: 1;
          padding: 0.75rem 1rem;
          border: 1px solid #ccc;
          border-radius: 0.5rem;
          transition: border-color 0.2s;
        }
        .chat-controls input:focus {
          border-color: #3b82f6;
          outline: none;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
        }
        .chat-controls button {
          padding: 0.75rem 1.5rem;
          background-color: #10b981; /* Emerald Green */
          color: white;
          border: none;
          border-radius: 0.5rem;
          cursor: pointer;
          font-weight: 600;
          transition: background-color 0.2s, opacity 0.2s;
        }
        .chat-controls button:hover:not(:disabled) {
          background-color: #059669;
        }
        .chat-controls button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        select {
          padding: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 0.5rem;
        }
      `}</style>

      <h1>BookTalk — Chat with a Character</h1>

      {/* Character Selector */}
      <div style={{ margin: "0.5rem 0 1.5rem 0" }}>
        <label
          htmlFor="character"
          style={{ marginRight: 8, fontWeight: "600" }}
        >
          Choose Character:
        </label>
        <select
          id="character"
          value={characterId}
          onChange={(e) => {
            const newId = e.target.value;
            // Reset chat history when switching characters
            setCharacterId(newId);
            setMessages([]);
            setInput("");
            setLoading(false);
          }}
          disabled={loading}
        >
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Chat Messages */}
      <div className="chat-container">
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.role}`}>
            <div className="messageInner">
              <strong className="messageLabel">
                {m.role === "user"
                  ? "You"
                  : characters.find((c) => c.id === characterId)?.name ||
                    "Character"}
              </strong>
              <div>
                {m.text}
                {m.isStreaming && <span className="streaming-cursor">|</span>}
              </div>
            </div>
          </div>
        ))}
        {loading && !messages.some((m) => m.isStreaming) && (
          <div
            style={{
              opacity: 0.7,
              fontStyle: "italic",
              padding: "0.75rem 1rem",
            }}
          >
            Thinking...
          </div>
        )}
      </div>

      {/* Input Controls */}
      <div className="chat-controls">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={loading}
          placeholder={`Talk to ${
            characters.find((c) => c.id === characterId)?.name ||
            "the character"
          }...`}
        />
        <button onClick={send} disabled={loading || !input}>
          Send
        </button>
      </div>
    </main>
  );
}

"use client";
import Sherlock from "../app/assests/sherlock.jpg";

import { useState, useMemo } from "react";

// Message type
type Message = {
  id: string;
  role: "user" | "character";
  text: string;
  isStreaming?: boolean;
};

// --- Gemini TTS Utility Functions (Kept outside component for clarity) ---

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
  const dataOffset = offset;
  for (let i = 0; i < pcmData.length; i++) {
    view.setInt16(dataOffset + i * 2, pcmData[i], true);
  }

  return new Blob([view], { type: "audio/wav" });
}

// --- Character Display Component (Using Images) ---

interface CharacterDisplayProps {
  characterId: string;
  name: string;
  imageUrl: string;
  isSpeaking: boolean;
}

const CharacterDisplay: React.FC<CharacterDisplayProps> = ({
  characterId,
  name,
  imageUrl,
  isSpeaking,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-4 bg-white rounded-xl shadow-2xl mb-4 w-full max-w-sm">
      <div className="relative w-32 h-32 rounded-full overflow-hidden border-4 border-gray-200 shadow-lg">
        {/* Character Image */}
        <img
          src={imageUrl}
          alt={`${name} Portrait`}
          className="w-full h-full object-cover"
          onError={(e) => {
            // Fallback if the placeholder image fails to load
            (
              e.target as HTMLImageElement
            ).src = `https://placehold.co/150x150/CCCCCC/000000?text=${name}`;
          }}
        />

        {/* Mouth Overlay for Lip Sync Animation */}
        <div
          id="mouth-overlay"
          className={`
            absolute left-1/2 -translate-x-1/2 top-[65%]
            w-[25%] h-[8%] rounded-sm
            ${
              isSpeaking
                ? "bg-red-500 animate-mouth-img opacity-80"
                : "bg-transparent"
            }
            transition-all duration-100
          `}
        ></div>
      </div>

      <h2 className="mt-3 text-2xl font-extrabold text-gray-800">{name}</h2>
      <p
        className={`text-sm ${
          isSpeaking ? "text-blue-600 font-semibold" : "text-gray-500"
        }`}
      >
        {isSpeaking ? "🗣️ Speaking..." : "...Awaiting Query..."}
      </p>
    </div>
  );
};

// --- Main Chat Component ---

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [characterId, setCharacterId] = useState<string>("sherlock");
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Character definitions with image placeholders and unique TTS voices
  const characters = useMemo(
    () => [
      {
        id: "sherlock",
        name: "Sherlock Holmes",
        image_url: Sherlock.src,
        tts_voice: "Kore",
      },
      {
        id: "harry",
        name: "Harry Potter",
        image_url:
          "https://placehold.co/150x150/7A0033/F0F8FF?text=Harry+Potter",
        tts_voice: "Leda",
      },
      {
        id: "snape",
        name: "Professor Snape",
        image_url:
          "https://placehold.co/150x150/2C2C2C/F0F8FF?text=Severus+Snape",
        tts_voice: "Charon",
      },
      {
        id: "dumbledore",
        name: "Albus Dumbledore",
        image_url:
          "https://placehold.co/150x150/993366/F0F8FF?text=Albus+Dumbledore",
        tts_voice: "Gacrux",
      },
    ],
    []
  );

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === characterId) || characters[0],
    [characterId, characters]
  );

  async function send() {
    if (!input || isSpeaking) return;

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

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: messageToSend,
          characterId,
          ttsVoice: selectedCharacter.tts_voice, // Pass the selected voice
          history,
          speech: true,
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
          const pcmBuffer = base64ToArrayBuffer(data.audioData);
          const pcm16 = new Int16Array(pcmBuffer);
          const wavBlob = pcmToWav(pcm16, data.sampleRate);
          const audioUrl = URL.createObjectURL(wavBlob);
          const audio = new Audio(audioUrl);

          // Start speaking animation and play audio
          audio.play().catch((e) => console.warn("Audio play prevented:", e));
          setIsSpeaking(true);

          // Clean up the object URL and stop speaking animation after audio finishes
          audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            setIsSpeaking(false);
          };
        } catch (audioErr) {
          console.error("Error processing audio data:", audioErr);
          setIsSpeaking(false);
        }
      } else {
        setIsSpeaking(false);
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
      className="font-sans flex flex-col items-center bg-gray-50 min-h-screen rounded-xl shadow-inner"
    >
      {/* Tailwind is provided via PostCSS (see postcss.config.mjs and tailwind.config.mjs) —
      removed synchronous CDN script to avoid Next.js 'no-sync-scripts' warning. */}
      <style jsx global>{`
        /* General Styling */
        body {
          background: #f0f4f8;
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
          text-align: center;
          width: 100%;
        }
        .chat-container {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1rem;
          border: 1px solid #e2e8f0;
          border-radius: 0.75rem;
          background: white;
          min-height: 350px;
          max-height: 40vh;
          overflow-y: auto;
          box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.06);
          width: 100%;
          margin-bottom: 1rem;
        }

        /* Message Styling (kept concise) */
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
          max-width: 85%;
          padding: 0.75rem 1rem;
          border-radius: 1.25rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          line-height: 1.5;
        }
        .user .messageInner {
          background-color: #3b82f6;
          color: white;
          border-bottom-right-radius: 0.25rem;
        }
        .character .messageInner {
          background-color: #e2e8f0;
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

        /* Streaming Cursor */
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

        /* Image Lip Sync Animation Keyframes */
        /* Applied to the small red overlay div */
        @keyframes mouth-move-img {
          0%,
          100% {
            transform: translate(-50%, 0) scaleX(1) scaleY(0.8); /* Neutral/Closed */
            opacity: 0.7;
          }
          50% {
            transform: translate(-50%, 5%) scaleX(1.3) scaleY(1.4); /* Open/Vowel sound - moves down slightly */
            opacity: 1;
            background-color: #ef4444; /* Brighter red when open */
          }
        }
        .animate-mouth-img {
          animation: mouth-move-img 0.1s infinite alternate ease-in-out; /* Fast cycle for speech simulation */
        }

        /* Controls */
        .chat-controls {
          display: flex;
          gap: 0.5rem;
          width: 100%;
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
          background-color: #10b981;
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

      <h1 className="w-full">BookTalk — Image-Synced Character AI</h1>

      {/* Character Face/Avatar - Centered and Animated */}
      <CharacterDisplay
        characterId={characterId}
        name={selectedCharacter.name}
        imageUrl={selectedCharacter.image_url}
        isSpeaking={isSpeaking}
      />

      {/* Character Selector - Centered */}
      <div className="mb-4 text-center">
        <label htmlFor="character" className="mr-2 font-semibold">
          Change Character:
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
            setIsSpeaking(false);
          }}
          disabled={loading || isSpeaking}
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
                {m.role === "user" ? "You" : selectedCharacter.name}
              </strong>
              <div>
                {m.text}
                {m.isStreaming && <span className="streaming-cursor">|</span>}
              </div>
            </div>
          </div>
        ))}
        {(loading || isSpeaking) && !messages.some((m) => m.isStreaming) && (
          <div className="opacity-70 italic p-3">
            {isSpeaking ? "Waiting for voice playback..." : "Thinking..."}
          </div>
        )}
      </div>

      {/* Input Controls */}
      <div className="chat-controls">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={loading || isSpeaking}
          placeholder={`Ask ${selectedCharacter.name} a question...`}
        />
        <button onClick={send} disabled={loading || !input || isSpeaking}>
          Send
        </button>
      </div>
    </main>
  );
}

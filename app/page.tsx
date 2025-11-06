"use client";
// src/pages/index.tsx
import { useState } from "react";

// Updated Message type to handle streaming state
type Message = {
  id: string;
  role: "user" | "character";
  text: string;
  isStreaming?: boolean;
};

// Note: previous streaming approach removed; we parse JSON responses instead.

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const characterId = "sherlock"; // wire to a selector for more characters

  async function send() {
    if (!input) return;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      text: input,
    };

    // Add the user message and a placeholder message for the character's reply
    const charMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        id: charMsgId,
        role: "character",
        text: "",
        isStreaming: true, // Mark this as the message being streamed
      },
    ]);

    // Clear input immediately
    const messageToSend = input;
    setInput("");

    setLoading(true);

    // Filter out the *new* placeholder message for the history sent to the API
    const history = messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    }));

    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send history *excluding* the streaming message placeholder
        // server expects `prompt`. Send the user's message as `prompt`.
        body: JSON.stringify({ prompt: messageToSend, characterId, history }),
      });

      if (!r.ok) {
        // ... (Error handling remains the same, but targets the streaming message ID)
        const text = await r.text();
        // ... (rest of error parsing)

        let errorMsg = `Server error ${r.status}`;
        // Simplified error message for brevity
        if (typeof text === "string") errorMsg = text;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === charMsgId
              ? {
                  ...m,
                  text: `API error: ${errorMsg}`,
                  isStreaming: false,
                }
              : m
          )
        );

        setLoading(false);
        return;
      }

      // The server returns JSON { text: string } (not a raw text stream).
      // Parse JSON and set the character message to the returned text.
      const data = await r.json();
      const text =
        data?.text ?? (typeof data === "string" ? data : JSON.stringify(data));

      setMessages((prev) =>
        prev.map((m) =>
          m.id === charMsgId
            ? {
                ...m,
                text,
                isStreaming: false,
              }
            : m
        )
      );
    } catch (err) {
      console.error(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === charMsgId
            ? {
                ...m,
                text: "Error contacting server.",
                isStreaming: false,
              }
            : m
        )
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>BookTalk — Chat with a character</h1>
      <div className="chat-container">
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.role}`}>
            <div className="messageInner">
              <strong className="messageLabel">
                {m.role === "user" ? "You" : "Character"}
              </strong>
              <div>
                {m.text}
                {/* Display a streaming indicator if the message is currently being streamed */}
                {m.isStreaming && <span className="streaming-cursor">|</span>}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ opacity: messages.some((m) => m.isStreaming) ? 0 : 1 }}>
            Thinking...
          </div>
        )}
      </div>

      <div className="chat-controls">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              send();
            }
          }}
          disabled={loading} // Disable input while streaming
        />
        <button onClick={send} disabled={loading || !input}>
          Send
        </button>
      </div>
    </main>
  );
}

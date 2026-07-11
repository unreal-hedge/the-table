"use client";
// Compact room chat: message list (server keeps the last ~50) + input.
// Toggled by the 💬 button in TableView; bubbles near seats are the
// live view, this panel is the catch-up view.

import { useEffect, useRef, useState } from "react";
import { ChatEntry, CHAT_MAX_LENGTH } from "@shared/protocol";

interface Props {
  entries: ChatEntry[];
  myId: string;
  onSend: (text: string) => void;
  onClose: () => void;
}

export function ChatPanel({ entries, myId, onSend, onClose }: Props) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // keep the newest message in view
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <span>Chat</span>
        <button className="close" onClick={onClose} aria-label="Close chat">✕</button>
      </div>
      <div className="chat-list" ref={listRef}>
        {entries.length === 0 && (
          <div className="chat-empty">Nothing yet — say something.</div>
        )}
        {entries.map((e, i) => (
          <div className="chat-msg" key={`${e.at}-${i}`}>
            <span className={`chat-from${e.fromId === myId ? " me" : ""}`}>{e.from}</span>
            <span className="chat-text">{e.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-input-row">
        <input
          type="text" placeholder="message…" value={draft}
          maxLength={CHAT_MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        />
        <button className="mini-btn" onClick={send} disabled={!draft.trim()}>Send</button>
      </div>
    </div>
  );
}

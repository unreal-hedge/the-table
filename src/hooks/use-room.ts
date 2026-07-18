"use client";
// ============================================================
// useRoom — the client's single connection to the game server.
//
// Wraps PartySocket (auto-reconnecting websocket) and turns the
// server's messages into React state. This hook is the ONLY place
// the client touches the wire; components stay dumb renderers.
//
// Connection status is tracked explicitly because a frozen table
// and a disconnected one look identical otherwise:
//   connecting   → first connect still in flight
//   connected    → live
//   reconnecting → dropped, PartySocket is retrying
//   disconnected → down for 15s+ (still retrying underneath)
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { PartySocket } from "partysocket";
import type { DftDecision, GameState, LedgerRow, PlayerAction, SessionSummary } from "@/engine/types";
import type {
  ChatEntry, ClientMessage, HostCommand, PresenceMember, ServerMessage,
} from "@shared/protocol";

export type ConnectionStatus =
  | "connecting" | "connected" | "reconnecting" | "disconnected";

// After this long without a socket, "reconnecting" becomes the harder
// "disconnected" (retries continue — this is about honest display).
const DISCONNECTED_AFTER_MS = 15_000;

// The party name is the kebab-cased Durable Object binding (TableServer).
const PARTY_NAME = "table-server";
const DEFAULT_HOST = "127.0.0.1:8787"; // `npm run party:dev`

export interface RoomHandle {
  status: ConnectionStatus;
  members: PresenceMember[];   // who's in the room right now
  state: GameState | null;     // latest filtered snapshot (null pre-start)
  ledger: LedgerRow[];         // session ledger, server-computed
  chat: ChatEntry[];
  summary: SessionSummary | null; // set when the host ends the session
  lastError: string | null;    // most recent server rejection, if any
  mySeat: number | null;
  isHost: boolean;             // server-confirmed (roster), not client-guessed
  kicked: boolean;             // seat taken over from another device (8.2)
  clockSkewMs: number;         // serverNow - clientNow; countdowns add this
  rejoin: () => void;          // deliberate re-login (kicks the other device back)
  send: {
    act: (action: PlayerAction, amount?: number) => void;
    timeBank: () => void;
    show: () => void;
    chat: (text: string) => void;
    host: (cmd: HostCommand) => void;
    submitArrangement: (order: number[]) => void;       // DFT picking (6b)
    declare: (potIndex: number, decision: DftDecision) => void; // DFT decisions (6b)
    requestSeat: (seat: number) => void;                // spectator asks for an empty seat (item 2)
  };
}

export function useRoom(room: string, myId: string, keyword: string): RoomHandle {
  const socketRef = useRef<PartySocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [state, setState] = useState<GameState | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [kicked, setKicked] = useState(false);
  const [clockSkewMs, setClockSkewMs] = useState(0);
  // bumping this remounts the socket — used by rejoin() after a kick
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const socket = new PartySocket({
      host: process.env.NEXT_PUBLIC_PARTY_HOST ?? DEFAULT_HOST,
      party: PARTY_NAME,
      room,
    });
    socketRef.current = socket;
    let downTimer: ReturnType<typeof setTimeout> | null = null;
    let wasKicked = false;

    const onOpen = () => {
      if (downTimer) { clearTimeout(downTimer); downTimer = null; }
      setStatus("connected");
      // (Re)announce identity on every connect — a reconnect is a new
      // socket, and the server maps identity per connection.
      socket.send(JSON.stringify(
        { type: "join", playerId: myId, keyword } satisfies ClientMessage
      ));
    };

    const onClose = () => {
      if (wasKicked) return; // deliberate close — no reconnect UX
      setStatus((prev) => (prev === "disconnected" ? prev : "reconnecting"));
      if (!downTimer) {
        downTimer = setTimeout(() => setStatus("disconnected"), DISCONNECTED_AFTER_MS);
      }
    };

    const onMessage = (e: MessageEvent) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      switch (msg.type) {
        case "state":
          setState(msg.state);
          // display-only skew estimate; network transit inflates it by a few
          // ms, irrelevant next to the multi-second phone-clock drift it fixes
          setClockSkewMs(msg.at - Date.now());
          break;
        case "noGame":      setState(null); setSummary(null); break;
        case "ledger":      setLedger(msg.rows); break;
        case "presence":    setMembers(msg.members); break;
        case "chat":        setChat((c) => [...c.slice(-49), msg.entry]); break;
        case "chatHistory": setChat(msg.entries); break;
        case "ended":       setSummary(msg.summary); break;
        case "error":       setLastError(msg.msg); break;
        case "you":         setIsHost(msg.host); break; // seat derives from state
        case "kicked":
          // another device took this seat — STOP reconnecting, or the
          // two devices would kick each other in a loop
          wasKicked = true;
          setKicked(true);
          socket.close();
          break;
      }
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    socket.addEventListener("message", onMessage);
    return () => {
      if (downTimer) clearTimeout(downTimer);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("message", onMessage);
      socket.close();
      socketRef.current = null;
    };
  }, [room, myId, keyword, attempt]);

  // auto-dismiss server rejections after a few seconds
  useEffect(() => {
    if (!lastError) return;
    const t = setTimeout(() => setLastError(null), 4000);
    return () => clearTimeout(t);
  }, [lastError]);

  const mySeat = state?.seats.find((s) => s.id === myId)?.seat ?? null;

  const rejoin = () => {
    setKicked(false);
    setStatus("connecting");
    setAttempt((n) => n + 1); // remounts the socket → fresh join
  };

  const send = useMemo(() => {
    const post = (msg: ClientMessage) => socketRef.current?.send(JSON.stringify(msg));
    return {
      act: (action: PlayerAction, amount?: number) => post({ type: "act", action, amount }),
      timeBank: () => post({ type: "timeBank" }),
      show: () => post({ type: "show" }),
      chat: (text: string) => post({ type: "chat", text }),
      host: (cmd: HostCommand) => post({ type: "host", cmd }),
      submitArrangement: (order: number[]) => post({ type: "submitArrangement", order }),
      declare: (potIndex: number, decision: DftDecision) => post({ type: "declare", potIndex, decision }),
      requestSeat: (seat: number) => post({ type: "requestSeat", seat }),
    };
  }, []);

  return {
    status, members, state, ledger, chat, summary, lastError, mySeat,
    isHost, kicked, clockSkewMs, rejoin, send,
  };
}

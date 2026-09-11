"use client";
// ============================================================
// TableView — the poker scene, extracted from page.tsx so BOTH
// modes render the exact same table:
//   hotseat: driven by a local GameManager (LocalGame)
//   online:  driven by server-pushed GameState (OnlineGame)
// Pure renderer: everything it knows arrives via props.
// ============================================================

import { ReactNode, useEffect, useState } from "react";
import { fmt } from "@/engine/manager";
import { DftDecision, GameState, LedgerRow, PlayerAction, Variant } from "@/engine/types";
import { ChatEntry } from "@shared/protocol";
import { Seat } from "./Seat";
import { CardFace } from "./CardFace";
import { ActionBar, LogStrip } from "./ActionBar";
import { LedgerPanel } from "./LedgerPanel";
import { ChatPanel } from "./ChatPanel";
import { DftPicking } from "./DftPicking";
import { DftDecisions } from "./DftDecisions";
import { DftReveal } from "./DftReveal";
import { Sheet } from "./Sheet";
import { Dialog, DialogSpec } from "./Dialog";

// how long a chat line floats as a bubble next to its sender's seat
const BUBBLE_MS = 4500;

// seat positions: ellipse in scene %, seat 0 at the bottom, clockwise
function seatPos(i: number, n: number) {
  const angle = Math.PI / 2 + (2 * Math.PI * i) / n; // start bottom
  const x = 50 + 34 * Math.cos(angle);
  const y = 44 + 30 * Math.sin(angle);
  const bx = 50 + 20 * Math.cos(angle);
  const by = 45 + 16 * Math.sin(angle);
  return { x, y, bx, by };
}

interface Props {
  state: GameState;
  mode: "hotseat" | "online";
  mySeat?: number | null;        // online: which seat is me
  isHost: boolean;               // pause/end controls + ledger editing
  ledgerRows: LedgerRow[];
  clockOffsetMs?: number;        // serverNow - clientNow (display-only skew fix)
  connectedIds?: Set<string>;    // online: ids with a live connection (presence)
  chat?: ChatEntry[];            // online: room chat (bubbles + panel)
  myId?: string;                 // online: for styling own chat lines
  onChat?: (text: string) => void;
  connPill?: ReactNode;          // online: connection status pill (top-left corner)
  roomLine?: string;             // online: "in room: …" presence (shown in the menu sheet)
  overlay?: ReactNode;           // online: disconnect veil / error toast
  onAct: (a: PlayerAction, amount?: number) => void;
  onTimeBank?: () => void;       // absent → button hidden
  onShow: () => void;
  onPause?: () => void;
  onEnd?: () => void;
  onSetMode?: (mode: Variant) => void; // host: switch NLHE <-> DFT (next hand)
  onSubmitArrangement?: (order: number[]) => void;          // DFT picking (6b)
  onDeclare?: (potIndex: number, decision: DftDecision) => void; // DFT decisions (6b)
  onAddChips?: (id: string, amount: number) => void;
  onSitToggle?: (id: string, out: boolean) => void;
  onRequestSeat?: (seat: number) => void;                                                 // spectator taps an empty seat (item 2)
  onSeatRequest?: (playerId: string, action: "accept" | "reject" | "ignore", stack?: number) => void; // admin resolves it
  onRequestChips?: (amount: number) => void;                                              // seated player asks for a rebuy (item 3)
  onChipRequest?: (playerId: string, action: "approve" | "reject", amount?: number) => void; // admin resolves it
  onDealNext?: () => void;   // admin advances a parked handEnded table (item 4)
  onRestart?: () => void;    // admin stops + starts a fresh session, same crew (item 4)
}

export function TableView({
  state: s, mode, mySeat = null, isHost, ledgerRows, clockOffsetMs = 0,
  connectedIds, chat, myId, onChat, connPill, roomLine, overlay,
  onAct, onTimeBank, onShow, onPause, onEnd, onSetMode,
  onSubmitArrangement, onDeclare, onAddChips, onSitToggle,
  onRequestSeat, onSeatRequest, onRequestChips, onChipRequest, onDealNext, onRestart,
}: Props) {
  const [showLedger, setShowLedger] = useState(false);
  const [peekSeat, setPeekSeat] = useState<number | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [chatSeenCount, setChatSeenCount] = useState(0);
  // the compact top-right menu + the admin requests queue live in one sheet
  // slot (KABIR-TODO #1, #2); every prompt/confirm is an in-app dialog (#6)
  const [sheet, setSheet] = useState<"menu" | "requests" | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  // display-only countdown tick (timeout decisions live elsewhere:
  // hotseat → LocalGame's loop; online → the server)
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, []);

  const n = s.seats.length;
  // deadlines are SERVER epoch ms — offset our clock so the bar reads true
  const displayNow = Date.now() + clockOffsetMs;
  const timerPct = s.turnDeadlineAt && s.turnStartedAt
    ? Math.max(0, (s.turnDeadlineAt - displayNow) / (s.turnDeadlineAt - s.turnStartedAt))
    : null;
  const winBySeat = new Map(
    (s.phase === "handEnded" ? s.lastHandResult ?? [] : []).map((r) => [
      r.seat,
      `WINS ${fmt(r.amountWon)}${r.handName ? " · " + r.handName.toUpperCase() : ""}`,
    ])
  );
  const sittingOut: Record<string, boolean> = {};
  for (const seat of s.seats) sittingOut[seat.id] = seat.sittingOut;

  // freshest chat line per seat, young enough to float as a bubble
  const bubbleBySeatId = new Map<string, string>();
  if (chat) {
    for (const e of chat) {
      if (displayNow - e.at < BUBBLE_MS) bubbleBySeatId.set(e.fromId, e.text);
    }
  }
  const unreadChat = (chat?.length ?? 0) - chatSeenCount;

  const seated = mode === "hotseat" || mySeat != null; // spectators get no action bar (#4)
  const myTurn = mode === "hotseat" || (mySeat != null && s.playerToAct === mySeat);
  const canShow = mode === "hotseat"
    ? s.canShowSeat != null
    : s.canShowSeat != null && s.canShowSeat === mySeat;

  // DFT overlay gating: only a viewer who is actively picking / owes a decision
  // gets the modal. Spectators + folded players must NEVER be stuck behind it —
  // they watch the table.
  const pk = s.dft?.subPhase === "picking" ? s.dft.picking : null;
  const iAmPicking = pk != null && mySeat != null && pk.seats.includes(mySeat);
  const iPickLocked = pk != null && mySeat != null && pk.lockedSeats.includes(mySeat);
  const dec = s.dft?.subPhase === "decisions" ? s.dft.decisions : null;
  const iOweDecision =
    dec != null && mySeat != null &&
    dec.contests.some(
      (c) => c.seats.includes(mySeat!) &&
        !dec.lockedSeats.some((l) => l.seat === mySeat && l.potIndex === c.potIndex)
    );

  const requestCount = (isHost ? (s.seatRequests?.length ?? 0) + (s.chipRequests?.length ?? 0) : 0);
  const closeSheet = () => setSheet(null);
  const modeLabel = s.variant === "dft" ? "Hold'em" : "Double Flop";

  return (
    <div className="scene">
      <div className="title-corner">The Table <span className="suit">♠</span></div>
      <div className="blind-corner mono">
        blinds {fmt(s.config.smallBlind)}/{fmt(s.config.bigBlind)} · hand #{s.handNumber}
      </div>
      {(connPill || !seated) && (
        <div className="net-corner">
          {connPill}
          {mode === "online" && !seated && (
            <span className="room-line spectate-note">watching — not seated</span>
          )}
        </div>
      )}

      {/* Compact top-right cluster: an alert pill for pending requests (admins)
          and ONE menu button. Nothing here ever overlaps a seat (#1). */}
      <div className="menu-cluster">
        {requestCount > 0 && (
          <button className="menu-pill alert" onClick={() => setSheet("requests")}>
            Requests <b>{requestCount}</b>
          </button>
        )}
        <button className="menu-pill" onClick={() => setSheet("menu")} aria-label="Table menu">
          <span aria-hidden="true">☰</span> Table
        </button>
      </div>

      <div className="table-wrap">
        <div className="felt" />
        <div className="table-brand">{s.dft ? "Double Flop" : "The Table"}</div>
        {s.round && <div className="round-tag">{s.round}</div>}
        {s.dft ? (
          <div className="dft-boards">
            <div className="dft-board">
              <span className="dft-board-tag">Board A</span>
              <div className="dft-cards">
                {s.dft.boards.a.map((c, i) => <CardFace key={`a${i}`} card={c} small />)}
              </div>
            </div>
            {s.totalPot > 0 && <div className="pot-line dft-pot">POT {fmt(s.totalPot)}</div>}
            <div className="dft-board">
              <span className="dft-board-tag">Board B</span>
              <div className="dft-cards">
                {s.dft.boards.b.map((c, i) => <CardFace key={`b${i}`} card={c} small />)}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="board">
              {s.communityCards.map((c, i) => <CardFace key={i} card={c} />)}
            </div>
            {s.totalPot > 0 && <div className="pot-line">POT {fmt(s.totalPot)}</div>}
          </>
        )}
      </div>

      {s.seats.map((v, i) => {
        const p = seatPos(i, n);
        const peeking = mode === "online" ? v.seat === mySeat : peekSeat === v.seat;
        // a spectator (not seated) may tap an empty seat to request it (item 2)
        const canRequest = mode === "online" && mySeat == null && !!v.empty && !!onRequestSeat;
        return (
          <Seat key={v.seat} view={v}
            x={p.x} y={p.y} betX={p.bx} betY={p.by}
            timerPct={v.isTurn ? timerPct : null}
            peeking={peeking}
            peekable={mode === "hotseat"}
            offline={connectedIds && !v.empty ? !connectedIds.has(v.id) : false}
            bubble={bubbleBySeatId.get(v.id) ?? null}
            backCount={s.dft ? 6 : 2}
            canRequest={canRequest}
            onRequestSeat={() => onRequestSeat?.(v.seat)}
            onPeek={() => setPeekSeat(peekSeat === v.seat ? null : v.seat)}
            winBadge={winBySeat.get(v.seat) ?? null}
          />
        );
      })}

      {canShow && (
        <button className="menu-pill show-btn" onClick={onShow}>Show winning cards</button>
      )}

      {/* Seated players get the action bar; spectators never see disabled
          betting buttons (#4) — just the dealer log on wide screens. */}
      {seated ? (
        <ActionBar state={s} enabled={myTurn}
          onAct={(a, amt) => { onAct(a, amt); setPeekSeat(null); }}
          onTimeBank={onTimeBank}
        />
      ) : (
        <div className="spectator-strip"><LogStrip log={s.log} /></div>
      )}

      {/* Picking overlay: only a viewer who is actually picking sees it. An
          active picker gets the interactive splitter; one who's locked in gets
          a passive "waiting" veil; spectators + folded players see neither. */}
      {s.dft && s.dft.subPhase === "picking" && s.dft.picking && iAmPicking && (
        !iPickLocked && onSubmitArrangement && mode === "online" ? (
          <DftPicking
            key={s.handNumber}
            holeCards={s.seats.find((x) => x.seat === mySeat)?.holeCards ?? null}
            boards={s.dft.boards}
            picking={s.dft.picking}
            mySeat={mySeat}
            initialOrder={s.seats.find((x) => x.seat === mySeat)?.arrangement ?? null}
            deadlineAt={s.turnDeadlineAt}
            displayNow={displayNow}
            onSubmit={onSubmitArrangement}
          />
        ) : (
          <div className="veil">
            <div>
              <div className="msg">Locked in ✓</div>
              <div className="hint">Waiting for the others to choose their hands…</div>
            </div>
          </div>
        )
      )}

      {/* Decisions overlay: only a viewer who still owes a run/surrender call. */}
      {s.dft && s.dft.subPhase === "decisions" && s.dft.decisions && iOweDecision && onDeclare && mode === "online" && (
        <DftDecisions
          key={s.handNumber}
          decisions={s.dft.decisions}
          mySeat={mySeat}
          deadlineAt={s.turnDeadlineAt}
          displayNow={displayNow}
          onDeclare={onDeclare}
        />
      )}

      {/* Why the table can't deal (both modes) — item 1, so it's never silent. */}
      {s.waitingReason && s.phase !== "inHand" && (
        <div className="waiting-banner">{s.waitingReason}</div>
      )}

      {s.dft && s.phase === "handEnded" && s.dft.flips.length > 0 && (
        <DftReveal
          key={s.handNumber}
          flips={s.dft.flips}
          result={s.lastHandResult ?? []}
          nameOf={(seat) => s.seats.find((x) => x.seat === seat)?.name ?? `Seat ${seat + 1}`}
        />
      )}

      {s.phase === "paused" && (
        <div className="veil">
          <div>
            <div className="msg">Paused</div>
            <div className="hint">
              {isHost && onPause
                ? "Clock is frozen. Take your time."
                : "Clock is frozen. Waiting for the host to resume."}
            </div>
            {isHost && onPause && (
              <button className="primary-btn" onClick={onPause}>Resume</button>
            )}
          </div>
        </div>
      )}

      {onChat && (
        <button
          className="chat-fab"
          aria-label="Chat"
          onClick={() => {
            setShowChat(!showChat);
            setChatSeenCount(chat?.length ?? 0);
          }}
        >
          💬{!showChat && unreadChat > 0 && <span className="chat-dot" />}
        </button>
      )}
      {showChat && onChat && (
        <ChatPanel entries={chat ?? []} myId={myId ?? ""}
          onSend={onChat} onClose={() => { setShowChat(false); setChatSeenCount(chat?.length ?? 0); }} />
      )}

      {showLedger && (
        <LedgerPanel rows={ledgerRows}
          canEdit={isHost && !!onAddChips} maxBuyIn={s.config.maxBuyIn}
          onAddChips={(id, amt) => onAddChips?.(id, amt)}
          onSitToggle={(id, out) => onSitToggle?.(id, out)}
          sittingOut={sittingOut}
          onClose={() => setShowLedger(false)}
        />
      )}

      {/* ---- the table menu: everyone's controls + the admin group (#1) ---- */}
      {sheet === "menu" && (
        <Sheet title="Table" onClose={closeSheet}>
          {roomLine && <div className="sheet-note">{roomLine}</div>}
          <div className="sheet-group">
            <button className="sheet-item" onClick={() => { closeSheet(); setShowLedger(true); }}>
              Ledger <span className="hint">session</span>
            </button>
            {mode === "online" && mySeat != null && onRequestChips && (
              <button className="sheet-item" onClick={() => {
                closeSheet();
                setDialog({
                  title: "Request chips",
                  message: "An admin approves it; the chips land between hands.",
                  input: { label: "Chips to add", initial: s.config.defaultBuyIn, min: 1, max: s.config.maxBuyIn, step: 50 },
                  confirmLabel: "Send request",
                  onConfirm: (v) => { if (v) onRequestChips(v); },
                });
              }}>
                Request chips <span className="hint">rebuy / top-up</span>
              </button>
            )}
            {requestCount > 0 && (
              <button className="sheet-item" onClick={() => setSheet("requests")}>
                Requests <span className="hint">{requestCount} pending</span>
              </button>
            )}
          </div>
          {isHost && (
            <div className="sheet-group">
              <div className="sheet-label">Admin</div>
              {onPause && (
                <button className="sheet-item" onClick={() => { closeSheet(); onPause(); }}>
                  {s.phase === "paused" ? "Resume" : "Pause"} <span className="hint">freeze the clock</span>
                </button>
              )}
              {onDealNext && s.phase === "handEnded" && (
                <button className="sheet-item" onClick={() => { closeSheet(); onDealNext(); }}>
                  Deal next hand <span className="hint">table is parked</span>
                </button>
              )}
              {onSetMode && (
                <button className="sheet-item" onClick={() => { closeSheet(); onSetMode(s.variant === "dft" ? "nlhe" : "dft"); }}>
                  Switch to {modeLabel} <span className="hint">from next hand</span>
                </button>
              )}
              {onRestart && (
                <button className="sheet-item danger" onClick={() => {
                  closeSheet();
                  setDialog({
                    title: "Restart the game?",
                    message: "Settles the current session into the ledger and deals a fresh game with the same seated players and fresh buy-ins.",
                    confirmLabel: "Restart", danger: true,
                    onConfirm: () => onRestart(),
                  });
                }}>
                  Restart game <span className="hint">settle + redeal</span>
                </button>
              )}
              {onEnd && (
                <button className="sheet-item danger" onClick={() => {
                  closeSheet();
                  setDialog({
                    title: "End the session?",
                    message: "Stops the game and finalises everyone's ledger.",
                    confirmLabel: "End session", danger: true,
                    onConfirm: () => onEnd(),
                  });
                }}>
                  End session <span className="hint">final ledger</span>
                </button>
              )}
            </div>
          )}
        </Sheet>
      )}

      {/* ---- admin request queue: seat requests (item 2) + rebuys (item 3) (#2) ---- */}
      {sheet === "requests" && isHost && (
        <Sheet title="Requests" onClose={closeSheet}>
          {requestCount === 0 && <div className="sheet-note">Nothing pending.</div>}
          {onSeatRequest && s.seatRequests?.map((rq) => (
            <div key={`s${rq.playerId}`} className="rq-row">
              <div className="rq-name">{rq.name} wants seat {rq.seat + 1}{rq.ignored ? " · ignored" : ""}</div>
              <div className="rq-btns">
                <button className="ok" onClick={() => onSeatRequest(rq.playerId, "accept")}>Accept · {fmt(s.config.defaultBuyIn)}</button>
                <button onClick={() => {
                  setDialog({
                    title: `Buy-in for ${rq.name}`,
                    input: { label: "Starting stack", initial: s.config.defaultBuyIn, min: s.config.minBuyIn, max: s.config.maxBuyIn, step: 50 },
                    confirmLabel: "Seat them",
                    onConfirm: (v) => { if (v) onSeatRequest(rq.playerId, "accept", v); },
                  });
                }}>Edit stack</button>
                <button onClick={() => onSeatRequest(rq.playerId, "reject")}>Reject</button>
                {!rq.ignored && <button onClick={() => onSeatRequest(rq.playerId, "ignore")}>Ignore</button>}
              </div>
            </div>
          ))}
          {onChipRequest && s.chipRequests?.map((rq) => (
            <div key={`c${rq.playerId}`} className="rq-row">
              <div className="rq-name">{rq.name} asks for +{fmt(rq.amount)} chips</div>
              <div className="rq-btns">
                <button className="ok" onClick={() => onChipRequest(rq.playerId, "approve")}>Approve</button>
                <button onClick={() => {
                  setDialog({
                    title: `Rebuy for ${rq.name}`,
                    input: { label: "Chips to add", initial: rq.amount, min: 1, max: s.config.maxBuyIn, step: 50 },
                    confirmLabel: "Approve",
                    onConfirm: (v) => { if (v) onChipRequest(rq.playerId, "approve", v); },
                  });
                }}>Edit amount</button>
                <button onClick={() => onChipRequest(rq.playerId, "reject")}>Reject</button>
              </div>
            </div>
          ))}
        </Sheet>
      )}

      {dialog && <Dialog spec={dialog} onClose={() => setDialog(null)} />}

      {overlay}
    </div>
  );
}

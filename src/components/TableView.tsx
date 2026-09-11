"use client";
// ============================================================
// TableView — the poker scene, extracted from page.tsx so BOTH
// modes render the exact same table:
//   hotseat: driven by a local GameManager (LocalGame)
//   online:  driven by server-pushed GameState (OnlineGame)
// Pure renderer: everything it knows arrives via props.
//
// Layout rules (readability pass):
//  - POV rotation (1E.6): the viewer always sits at the BOTTOM; seats
//    rotate around them; the dealer button follows its seat.
//  - Double Flop: the viewer's six cards live in the HandDock at the
//    bottom, always grouped HAND A | TEX | HAND B; the two boards sit
//    stacked on the felt with matching A/B colours.
//  - Phones get an explicit seat map (not the desktop ellipse) so the
//    five-card board rows never collide with the side seats.
// ============================================================

import { ReactNode, useEffect, useState } from "react";
import { fmt } from "@/engine/manager";
import { DftDecision, GameState, LedgerRow, PlayerAction, SeatView, Variant } from "@/engine/types";
import { ChatEntry } from "@shared/protocol";
import { Seat, SeatExtras } from "./Seat";
import { CardFace } from "./CardFace";
import { ActionBar, LogStrip } from "./ActionBar";
import { LedgerPanel } from "./LedgerPanel";
import { ChatPanel } from "./ChatPanel";
import { DftDecisions } from "./DftDecisions";
import { HandDock } from "./HandDock";
import { Sheet } from "./Sheet";
import { Dialog, DialogSpec } from "./Dialog";
import { buildFrame, ShowdownPanel } from "./Showdown";
import { usePresentation } from "@/hooks/use-presentation";
import { labelHand, cardKey } from "@/lib/handLabel";

// how long a chat line floats as a bubble next to its sender's seat
const BUBBLE_MS = 4500;

/** [x, y] in scene %, display index 0 = the viewer at the bottom, clockwise. */
type Pt = [number, number];
// Phone maps: side rows sit ABOVE and BELOW the board band so a 5-card row
// never touches a plate; the top pair clears the corner chrome.
const PHONE_7: Pt[] = [[50, 62], [12, 52], [13, 21], [30, 12], [70, 12], [87, 21], [88, 52]];
const PHONE_8: Pt[] = [[50, 73], [15, 61], [12, 36], [29, 14], [50, 10], [71, 14], [88, 36], [85, 61]];
/** display indexes whose seats sit on the TOP rail (cards hang below the plate) */
const TOP_ROW: Record<number, number[]> = { 7: [3, 4], 8: [3, 4, 5] };

function seatPos(i: number, n: number, phone: boolean, variant: Variant) {
  if (phone) {
    const map = n === 7 ? PHONE_7 : n === 8 ? PHONE_8 : null;
    if (map) {
      const [x, y] = map[i];
      const cy = variant === "dft" ? 36 : 44; // the felt's centre band
      return { x, y, bx: x + (50 - x) * 0.42, by: y + (cy - y) * 0.42 };
    }
  }
  const angle = Math.PI / 2 + (2 * Math.PI * i) / n; // start bottom, clockwise
  const x = 50 + 34 * Math.cos(angle);
  const y = 44 + 30 * Math.sin(angle);
  const bx = 50 + 20 * Math.cos(angle);
  const by = 45 + 16 * Math.sin(angle);
  return { x, y, bx, by };
}

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setPhone(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return phone;
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
  onDraftArrangement?: (order: number[]) => void;           // DFT working split (2.4)
  onSubmitArrangement?: (order: number[]) => void;          // DFT picking lock (6b)
  onDeclare?: (potIndex: number, decision: DftDecision) => void; // DFT decisions (6b)
  onAddChips?: (id: string, amount: number) => void;
  onSitToggle?: (id: string, out: boolean) => void;
  onSitSelf?: (out: boolean) => void;   // online: I sit out / come back myself (1E.1)
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
  onDraftArrangement, onSubmitArrangement, onDeclare, onAddChips, onSitToggle, onSitSelf,
  onRequestSeat, onSeatRequest, onRequestChips, onChipRequest, onDealNext, onRestart,
}: Props) {
  const phone = useIsPhone();
  const [showLedger, setShowLedger] = useState(false);
  const [peekSeat, setPeekSeat] = useState<number | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [chatSeenCount, setChatSeenCount] = useState(0);
  // the compact top-right menu + the admin requests queue live in one sheet
  // slot (KABIR-TODO #1, #2); every prompt/confirm is an in-app dialog (#6)
  const [sheet, setSheet] = useState<"menu" | "requests" | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  // the board a selected dock group plays lights up (A ↔ Hand A)
  const [focusBoard, setFocusBoard] = useState<"a" | "b" | null>(null);

  // display-only countdown tick (timeout decisions live elsewhere:
  // hotseat → LocalGame's loop; online → the server)
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, []);

  const n = s.seats.length;
  const isDft = s.variant === "dft" && !!s.dft;
  // POV rotation (1E.6): I'm display index 0 (bottom); spectators see seat 1 there
  const anchor = mySeat ?? 0;
  const displayIndex = (seat: number) => (seat - anchor + n) % n;
  // the table's sense of time: dealing, reveals, the slow showdown (Part 3)
  const pres = usePresentation(s);
  const frame = pres.step ? buildFrame(s, pres.step, pres.stepElapsed) : null;
  const dealing = pres.dealt != null;
  const cy = phone ? (isDft ? 36 : 44) : 44; // the felt's centre line (scene %)
  // until the pot has moved, show the pre-settlement picture
  const stackOf = (v: SeatView) => (pres.frozen ? pres.frozen.stacks.get(v.seat) ?? v.stack : v.stack);
  const potShown = pres.frozen ? pres.frozen.pot : s.totalPot;
  // deadlines are SERVER epoch ms — offset our clock so the bar reads true
  const displayNow = Date.now() + clockOffsetMs;
  const timerPct = s.turnDeadlineAt && s.turnStartedAt
    ? Math.max(0, (s.turnDeadlineAt - displayNow) / (s.turnDeadlineAt - s.turnStartedAt))
    : null;
  const winBySeat = new Map(
    (s.phase === "handEnded" && !pres.frozen ? s.lastHandResult ?? [] : []).map((r) => [
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
  // SHOW HANDS (1E.7): once the hand is over, a folded player or the fold-win
  // winner may turn their cards up; the engine says who may
  const canShow = mode === "hotseat"
    ? (s.showableSeats?.length ?? 0) > 0 || s.canShowSeat != null
    : mySeat != null && ((s.showableSeats?.includes(mySeat) ?? false) || s.canShowSeat === mySeat);
  const me: SeatView | undefined = mySeat != null ? s.seats.find((x) => x.seat === mySeat) : undefined;

  // ---- Double Flop: my dock + the picking / decision phases ----
  const pk = isDft && s.dft!.subPhase === "picking" ? s.dft!.picking : null;
  const iAmPicking = pk != null && mySeat != null && pk.seats.includes(mySeat);
  const iPickLocked = pk != null && mySeat != null && pk.lockedSeats.includes(mySeat);
  const dec = isDft && s.dft!.subPhase === "decisions" ? s.dft!.decisions : null;
  const iOweDecision =
    dec != null && mySeat != null &&
    dec.contests.some(
      (c) => c.seats.includes(mySeat!) &&
        !dec.lockedSeats.some((l) => l.seat === mySeat && l.potIndex === c.potIndex)
    );
  // the dock shows whenever I hold six cards this hand (through handEnded)
  const dockCards = isDft && mode === "online" && me && !me.empty && me.holeCards && me.holeCards.length === 6 && !me.folded
    ? me.holeCards : null;
  const dockLocked = isDft && (iPickLocked || s.dft!.subPhase === "decisions" || s.phase === "handEnded");
  const dockEditable = !!dockCards && s.phase === "inHand" && !dockLocked && !!onDraftArrangement &&
    (s.dft!.subPhase === "betting" || (s.dft!.subPhase === "picking" && iAmPicking));
  // during picking / decisions the betting buttons are meaningless — free the
  // bottom of the screen for the dock's timer + LOCK; the showdown replay
  // takes that band too
  const showActionBar = seated && !frame &&
    !(isDft && (s.dft!.subPhase === "picking" || s.dft!.subPhase === "decisions") && s.phase === "inHand");

  const requestCount = (isHost ? (s.seatRequests?.length ?? 0) + (s.chipRequests?.length ?? 0) : 0);
  const closeSheet = () => setSheet(null);
  const modeLabel = s.variant === "dft" ? "Hold'em" : "Double Flop";

  // NLHE: name my own hand live too (pokernow-style)
  const myNlheLabel = !isDft && me?.holeCards && me.holeCards.length === 2 && s.communityCards.length >= 3
    ? labelHand(me.holeCards, s.communityCards) : null;

  const boardRow = (tag: "a" | "b", cards: GameState["communityCards"]) => {
    const live = frame?.liveBoard === tag;
    const dimmed = !!frame?.liveBoard && frame.liveBoard !== tag;
    return (
      <div className={`dft-board ${tag}${focusBoard === tag ? " focus" : ""}${live ? " live" : ""}${dimmed ? " dimmed" : ""}`}>
        <span className="dft-board-tag"><b>{tag.toUpperCase()}</b> Board {tag.toUpperCase()}</span>
        <div className="dft-cards">
          {cards.slice(0, pres.boards[tag]).map((c, i) => (
            <CardFace key={`${tag}${i}-${cardKey(c)}`} card={c} size={phone ? "sm" : "md"}
              lift={live && !!frame && frame.boardLift.has(cardKey(c))}
              dim={live && !!frame && frame.boardLift.size > 0 && !frame.boardLift.has(cardKey(c))} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={`scene${isDft ? " dft" : ""}${phone ? " phone" : ""}`}>
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
        {onChat && (
          <button
            className="menu-pill chat-fab"
            aria-label="Chat"
            onClick={() => {
              setShowChat(!showChat);
              setChatSeenCount(chat?.length ?? 0);
            }}
          >
            💬{!showChat && unreadChat > 0 && <span className="chat-dot" />}
          </button>
        )}
        <button className="menu-pill" onClick={() => setSheet("menu")} aria-label="Table menu">
          <span aria-hidden="true">☰</span> Table
        </button>
      </div>

      <div className="table-wrap">
        <div className="felt" />
        <div className="table-brand">{isDft ? "Double Flop" : "The Table"}</div>
        {s.round && <div className="round-tag">{s.round}</div>}
        {isDft ? (
          <div className="dft-boards">
            {boardRow("a", s.dft!.boards.a)}
            {potShown > 0 && <div className="pot-line dft-pot">POT {fmt(potShown)}</div>}
            {boardRow("b", s.dft!.boards.b)}
          </div>
        ) : (
          <>
            <div className="board">
              {s.communityCards.slice(0, pres.boards.c).map((c, i) => (
                <CardFace key={`${i}-${cardKey(c)}`} card={c} size={phone ? "sm" : "md"}
                  lift={!!frame && frame.boardLift.has(cardKey(c))}
                  dim={!!frame && frame.boardLift.size > 0 && !frame.boardLift.has(cardKey(c))} />
              ))}
            </div>
            {potShown > 0 && <div className="pot-line">POT {fmt(potShown)}</div>}
          </>
        )}
      </div>
      <div className={`dealer-puck${dealing ? " dealing" : ""}`} style={{ top: `${cy}%` }} aria-hidden="true">♠</div>

      {/* hole cards in flight: from the dealer to each seat, one at a time */}
      {pres.flights.map((f) => {
        const p = seatPos(displayIndex(f.seat), n, phone, s.variant);
        return (
          <div key={f.key} className="fly-card"
            style={{ left: `${p.x}%`, top: `${p.y}%`, ["--fx" as string]: `${50 - p.x}vw`, ["--fy" as string]: `${cy - p.y}dvh` }}>
            <CardFace card={null} size="xs" />
          </div>
        );
      })}

      {/* the pot sliding to the winner(s) */}
      {pres.step?.kind === "pot" && (s.lastHandResult ?? []).filter((r) => r.amountWon > 0).map((r) => {
        const p = seatPos(displayIndex(r.seat), n, phone, s.variant);
        return (
          <div key={r.seat} className="pot-fly"
            style={{ top: `${cy}%`, ["--tx" as string]: `${p.x - 50}vw`, ["--ty" as string]: `${p.y - cy}dvh` }}>
            +{fmt(r.amountWon)}
          </div>
        );
      })}

      {s.seats.map((v) => {
        const di = displayIndex(v.seat);
        const p = seatPos(di, n, phone, s.variant);
        const mine = v.seat === mySeat;
        const peeking = mode === "online" ? mine : peekSeat === v.seat;
        // a spectator (not seated) may tap an empty seat to request it (item 2)
        const canRequest = mode === "online" && mySeat == null && !!v.empty && !!onRequestSeat;
        const inDock = mine && !!dockCards && !frame; // my DFT seat lives in the dock (the panel takes over at showdown)
        const shownView: SeatView = pres.frozen && !v.empty ? { ...v, stack: stackOf(v), betSize: 0 } : v;
        return (
          <span key={v.seat}>
            {!inDock && (
              <Seat view={shownView}
                x={p.x} y={p.y}
                top={phone && (TOP_ROW[n] ?? []).includes(di)}
                fan={!mine && !v.revealed}
                phone={phone}
                frame={frame?.seats.get(v.seat)}
                visibleCards={pres.dealt?.get(v.seat)}
                timerPct={v.isTurn ? timerPct : null}
                peeking={peeking}
                peekable={mode === "hotseat"}
                offline={connectedIds && !v.empty ? !connectedIds.has(v.id) : false}
                bubble={bubbleBySeatId.get(v.id) ?? null}
                backCount={isDft ? 6 : 2}
                cardSize={mine && !isDft ? "md" : "xs"}
                canRequest={canRequest}
                onRequestSeat={() => onRequestSeat?.(v.seat)}
                onPeek={() => setPeekSeat(peekSeat === v.seat ? null : v.seat)}
                winBadge={winBySeat.get(v.seat) ?? null}
              />
            )}
            <SeatExtras view={v} betX={p.bx} betY={p.by} />
            {mine && !isDft && myNlheLabel && s.phase === "inHand" && !v.folded && (
              <div className="my-hand-name" style={{ left: `${p.x}%`, top: `${p.y}%` }}>{myNlheLabel.name}</div>
            )}
          </span>
        );
      })}

      {/* My six cards, always grouped (2.2) + live names (2.3) + rearranging (2.4).
          The picking phase happens right here: timer + LOCK on the dock. */}
      {dockCards && me && !frame && (
        <HandDock
          handNumber={s.handNumber}
          holeCards={dockCards}
          serverOrder={me.arrangement ?? null}
          boards={{ a: s.dft!.boards.a.slice(0, pres.boards.a), b: s.dft!.boards.b.slice(0, pres.boards.b) }}
          visibleCount={pres.dealt?.get(me.seat) ?? 6}
          editable={dockEditable && pres.ready}
          locked={dockLocked}
          picking={pk && iAmPicking ? {
            deadlineAt: s.turnDeadlineAt, displayNow,
            lockedCount: pk.lockedSeats.length, total: pk.seats.length,
          } : null}
          free={!showActionBar}
          onDraft={(order) => onDraftArrangement?.(order)}
          onLock={() => onSubmitArrangement?.(me.arrangement ?? [0, 1, 2, 3, 4, 5])}
          onFocusBoard={setFocusBoard}
        >
          <Seat view={pres.frozen ? { ...me, stack: stackOf(me), betSize: 0 } : me} hideCards
            timerPct={me.isTurn ? timerPct : null}
            peeking peekable={false}
            offline={false}
            bubble={bubbleBySeatId.get(me.id) ?? null}
            onPeek={() => {}}
            winBadge={winBySeat.get(me.seat) ?? null}
          />
        </HandDock>
      )}

      {canShow && !frame && (
        <button className="menu-pill show-btn" onClick={onShow}>Show hands</button>
      )}

      {/* Seated players get the action bar; spectators never see disabled
          betting buttons (#4) — just the dealer log on wide screens. */}
      {showActionBar ? (
        <ActionBar state={s} enabled={myTurn && pres.ready}
          onAct={(a, amt) => { onAct(a, amt); setPeekSeat(null); }}
          onTimeBank={onTimeBank}
        />
      ) : !seated && !frame ? (
        <div className="spectator-strip"><LogStrip log={s.log} /></div>
      ) : null}

      {/* The showdown, replayed slowly for EVERYONE (players, folded, spectators):
          Board A → Board B → each flip → outcomes → the pot to the winner. */}
      {frame && <ShowdownPanel frame={frame} free={!showActionBar} />}

      {/* Picking phase, for everyone NOT picking: a quiet felt banner. Pickers
          use the dock; nobody is ever stuck behind an overlay. */}
      {pk && !iAmPicking && (
        <div className="phase-banner">
          Players are choosing their hands · {pk.lockedSeats.length}/{pk.seats.length} locked
        </div>
      )}

      {/* Decisions overlay: only a viewer who still owes a run/surrender call. */}
      {dec && iOweDecision && onDeclare && mode === "online" && (
        <DftDecisions
          key={s.handNumber}
          decisions={dec}
          potCount={s.pots.length}
          mySeat={mySeat}
          deadlineAt={s.turnDeadlineAt}
          displayNow={displayNow}
          onDeclare={onDeclare}
        />
      )}
      {dec && !iOweDecision && (
        <div className="phase-banner">
          Run or surrender — blind calls in progress · {dec.lockedSeats.length}/{dec.contests.reduce((t, c) => t + c.seats.length, 0)} locked
        </div>
      )}

      {/* Why the table can't deal (both modes) — item 1, so it's never silent. */}
      {s.waitingReason && s.phase !== "inHand" && (
        <div className="waiting-banner">{s.waitingReason}</div>
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
            {mode === "online" && me && !me.empty && onSitSelf && (
              <button className="sheet-item" onClick={() => { closeSheet(); onSitSelf(!me.sittingOut); }}>
                {me.sittingOut ? "I'm back — deal me in" : "Sit out a while"}
                <span className="hint">{me.sittingOut ? "from the next hand" : "skips hands until you're back"}</span>
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

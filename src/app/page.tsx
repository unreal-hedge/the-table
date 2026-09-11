"use client";
// App shell: routes between the lobby and the two game modes.
// All game logic lives in LocalGame (hot-seat) / OnlineGame (server).
// Players only get the online flow; hot-seat is dev-only (/?dev=local).

import { useEffect, useState } from "react";
import { GameConfig, Variant } from "@/engine/types";
import { Lobby } from "@/components/Lobby";
import { SetupPlayer } from "@/components/GameSetupForm";
import { LocalGame } from "@/components/LocalGame";
import { OnlineGame } from "@/components/OnlineGame";
import { clearStoredLogin, readStoredLogin, storeLogin } from "@/lib/login";

type Screen =
  | { kind: "lobby" }
  | { kind: "local"; config: GameConfig; players: SetupPlayer[] }
  | { kind: "online"; room: string; myId: string; keyword: string; create?: { config: GameConfig; mode: Variant } };

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ kind: "lobby" });
  const toLobby = () => { clearStoredLogin(); setScreen({ kind: "lobby" }); };

  // Dev-only escape hatch for the hot-seat debug harness. Read after
  // mount (not during render) so server and client HTML always match.
  const [devLocal, setDevLocal] = useState(false);
  useEffect(() => {
    setDevLocal(new URLSearchParams(window.location.search).get("dev") === "local");
    // 1E.4: a refresh mid-session rejoins the same room + seat automatically.
    // A CREATE login rejoins as a plain join (the game already exists).
    const saved = readStoredLogin();
    if (saved) setScreen({ kind: "online", room: saved.room, myId: saved.myId, keyword: saved.keyword });
  }, []);

  const goOnline = (room: string, myId: string, keyword: string, create?: { config: GameConfig; mode: Variant }) => {
    storeLogin({ room, myId, keyword });
    setScreen({ kind: "online", room, myId, keyword, create });
  };

  switch (screen.kind) {
    case "local":
      return <LocalGame config={screen.config} players={screen.players} onExit={toLobby} />;
    case "online":
      return (
        <OnlineGame room={screen.room} myId={screen.myId} keyword={screen.keyword}
          create={screen.create} onExit={toLobby} />
      );
    default:
      return (
        <Lobby
          devLocal={devLocal}
          onStartLocal={(config, players) => setScreen({ kind: "local", config, players })}
          onJoinOnline={(room, myId, keyword) => goOnline(room, myId, keyword)}
          onCreateOnline={(room, myId, keyword, config, mode) => goOnline(room, myId, keyword, { config, mode })}
        />
      );
  }
}

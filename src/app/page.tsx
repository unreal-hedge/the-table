"use client";
// App shell: routes between the lobby and the two game modes.
// All game logic lives in LocalGame (hot-seat) / OnlineGame (server).
// Players only get the online flow; hot-seat is dev-only (/?dev=local).

import { useEffect, useState } from "react";
import { GameConfig } from "@/engine/types";
import { Lobby } from "@/components/Lobby";
import { SetupPlayer } from "@/components/GameSetupForm";
import { LocalGame } from "@/components/LocalGame";
import { OnlineGame } from "@/components/OnlineGame";

type Screen =
  | { kind: "lobby" }
  | { kind: "local"; config: GameConfig; players: SetupPlayer[] }
  | { kind: "online"; room: string; myId: string; keyword: string };

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ kind: "lobby" });
  const toLobby = () => setScreen({ kind: "lobby" });

  // Dev-only escape hatch for the hot-seat debug harness. Read after
  // mount (not during render) so server and client HTML always match.
  const [devLocal, setDevLocal] = useState(false);
  useEffect(() => {
    setDevLocal(new URLSearchParams(window.location.search).get("dev") === "local");
  }, []);

  switch (screen.kind) {
    case "local":
      return <LocalGame config={screen.config} players={screen.players} onExit={toLobby} />;
    case "online":
      return (
        <OnlineGame room={screen.room} myId={screen.myId} keyword={screen.keyword}
          onExit={toLobby} />
      );
    default:
      return (
        <Lobby
          devLocal={devLocal}
          onStartLocal={(config, players) => setScreen({ kind: "local", config, players })}
          onJoinOnline={(room, myId, keyword) => setScreen({ kind: "online", room, myId, keyword })}
        />
      );
  }
}

"use client";
// App shell: routes between the lobby and the two game modes.
// All game logic lives in LocalGame (hot-seat) / OnlineGame (server).

import { useState } from "react";
import { GameConfig } from "@/engine/types";
import { Lobby } from "@/components/Lobby";
import { SetupPlayer } from "@/components/GameSetupForm";
import { LocalGame } from "@/components/LocalGame";
import { OnlineGame } from "@/components/OnlineGame";

type Screen =
  | { kind: "lobby" }
  | { kind: "local"; config: GameConfig; players: SetupPlayer[] }
  | { kind: "online"; room: string; myId: string };

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ kind: "lobby" });
  const toLobby = () => setScreen({ kind: "lobby" });

  switch (screen.kind) {
    case "local":
      return <LocalGame config={screen.config} players={screen.players} onExit={toLobby} />;
    case "online":
      return <OnlineGame room={screen.room} myId={screen.myId} onExit={toLobby} />;
    default:
      return (
        <Lobby
          onStartLocal={(config, players) => setScreen({ kind: "local", config, players })}
          onJoinOnline={(room, myId) => setScreen({ kind: "online", room, myId })}
        />
      );
  }
}

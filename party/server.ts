// ============================================================
// THE TABLE — multiplayer server (PartyServer on Cloudflare).
//
// One instance of this class == one poker room, backed by a
// Cloudflare Durable Object. It is the AUTHORITATIVE game host:
// in later steps it owns a GameManager, holds the hidden cards,
// and broadcasts a per-player GameState (other players' holeCards
// stripped until showdown).
//
// RIGHT NOW this is a connectivity skeleton only — it accepts
// websocket connections and echoes messages, to prove the whole
// toolchain (wrangler build/dev → Durable Object → client socket)
// works before any game logic goes in (that's Step 3).
//
// NO UI CODE EVER. This file may import from shared/engine/ only.
// ============================================================

import { routePartykitRequest, Server, type Connection } from "partyserver";

/** Cloudflare bindings available to the worker. The Durable Object
 *  namespace name here MUST match the binding in party/wrangler.jsonc. */
export interface Env {
  TableServer: DurableObjectNamespace<TableServer>;
}

export class TableServer extends Server<Env> {
  // Hibernate the Durable Object when idle: the websocket stays open
  // but the instance sleeps, so an empty/quiet room costs nothing.
  static options = { hibernate: true };

  onStart() {
    console.log(`[TableServer] room "${this.name}" started`);
  }

  onConnect(conn: Connection) {
    console.log(`[TableServer] connect ${conn.id} → room "${this.name}"`);
    conn.send(JSON.stringify({ type: "hello", room: this.name, id: conn.id }));
  }

  onMessage(conn: Connection, message: string) {
    // Skeleton behavior: echo the message straight back so we can
    // confirm two-way messaging end to end. Step 3 replaces this with
    // the real protocol ({ type: "act" | "chat" | host controls }).
    conn.send(JSON.stringify({ type: "echo", from: conn.id, message }));
  }

  onClose(conn: Connection) {
    console.log(`[TableServer] close ${conn.id}`);
  }
}

// The Worker entry point: route every request to the right room's
// Durable Object. Non-party requests get a plain health-check reply.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("The Table server is running.", { status: 200 })
    );
  },
};

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ServerWebSocket } from "bun";
import { PanelRoom } from "./room.ts";

const port = Number(process.env.ACTOR_PORT || 8787);
const alarmMs = Number(process.env.ACTOR_ALARM_MS || 90_000);
const dataDir = path.resolve(process.cwd(), "data/actors");
mkdirSync(dataDir, { recursive: true });

type SocketData = { actorId: string };

const rooms = new Map<string, PanelRoom>();
const sockets = new Map<string, Set<ServerWebSocket<SocketData>>>();

function fileFor(id: string): string {
  return path.join(dataDir, `${id}.json`);
}

function persist(id: string, room: PanelRoom): void {
  writeFileSync(fileFor(id), JSON.stringify(room.snapshot()));
}

function roomFor(id: string): PanelRoom {
  const existing = rooms.get(id);
  if (existing) return existing;
  const room = new PanelRoom(alarmMs);
  try {
    const raw = readFileSync(fileFor(id), "utf8");
    room.hydrate(JSON.parse(raw));
  } catch {
    // A new panel has no file yet.
  }
  room.onEvent((event) => {
    persist(id, room);
    const message = JSON.stringify({ type: "event", event });
    for (const socket of sockets.get(id) ?? []) socket.send(message);
  });
  rooms.set(id, room);
  return room;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });
}

const server = Bun.serve<SocketData>({
  port,
  async fetch(req, bun) {
    if (req.method === "OPTIONS") return json({ ok: true });
    const url = new URL(req.url);
    if (url.pathname === "/health") return json({ ok: true, service: "actor" });

    const match = url.pathname.match(/^\/actors\/([^/]+)(?:\/([^/]+))?$/);
    if (!match?.[1]) return json({ ok: false, error: "not found" }, 404);
    const actorId = decodeURIComponent(match[1]);
    const action = match[2] ?? "";

    if (action === "ws") {
      if (bun.upgrade(req, { data: { actorId } })) return undefined;
      return json({ ok: false, error: "websocket upgrade failed" }, 400);
    }

    const room = roomFor(actorId);
    if (req.method === "GET" && (action === "state" || action === "")) {
      const state = await room.enqueue(() => room.getState());
      return json({ ok: true, ...state });
    }
    if (req.method !== "POST") return json({ ok: false, error: "not found" }, 404);

    const body = await req.json().catch(() => null);
    const result = await room.enqueue(() => {
      if (action === "start") return room.start(body);
      if (action === "submitReview") return room.submitReview(body);
      if (action === "submitCrossExam") return room.submitCrossExam(body?.persona, body?.notes);
      if (action === "postMessage") return room.postMessage(body?.persona, body?.text);
      if (action === "submitReport") return room.submitReport(body);
      return { ok: false as const, error: "unknown method" };
    });
    if (result.ok) persist(actorId, room);
    return json(result, result.ok ? 200 : 400);
  },
  websocket: {
    open(socket) {
      const set = sockets.get(socket.data.actorId) ?? new Set();
      set.add(socket);
      sockets.set(socket.data.actorId, set);
    },
    message(socket, raw) {
      let parsed: { type?: string } = {};
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (parsed.type !== "subscribe") return;
      const room = roomFor(socket.data.actorId);
      void room.enqueue(() => {
        socket.send(JSON.stringify({ type: "replay", events: room.getState().events }));
      });
    },
    close(socket) {
      sockets.get(socket.data.actorId)?.delete(socket);
    },
  },
});

console.log(`panel actor on http://127.0.0.1:${server.port}`);

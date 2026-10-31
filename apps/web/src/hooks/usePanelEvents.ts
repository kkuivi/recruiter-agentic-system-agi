import { useEffect, useState } from "react";
import type { PanelEvent, Phase } from "@proofhire/contracts";
import replayFile from "../../../../seed/fixtures/panel-replay.json";

export type RoomBackend = "connecting" | "actor" | "log" | "replay";

interface ReplayEvent extends PanelEvent {
  delayMs?: number;
}

function dedupe(events: PanelEvent[]): PanelEvent[] {
  const bySeq = new Map<number, PanelEvent>();
  for (const event of events) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function phaseFrom(events: PanelEvent[]): Phase {
  const latest = [...events].reverse().find((event) => event.kind === "phase" || event.kind === "report");
  if (!latest) return "idle";
  if (latest.kind === "report") return "done";
  return (latest.payload as { phase?: Phase }).phase ?? "idle";
}

export function usePanelEvents(candidateId: string, demo: boolean): { events: PanelEvent[]; phase: Phase; backend: RoomBackend } {
  const [events, setEvents] = useState<PanelEvent[]>([]);
  const [backend, setBackend] = useState<RoomBackend>(demo ? "replay" : "connecting");

  useEffect(() => {
    if (demo) {
      const timers: number[] = [];
      const recorded = (replayFile as { events: ReplayEvent[] }).events;
      let cursor = 350;
      recorded.forEach((event) => {
        cursor += event.delayMs ?? 700;
        timers.push(
          window.setTimeout(() => {
            setEvents((current) => dedupe([...current, event]));
          }, cursor),
        );
      });
      setBackend("replay");
      setEvents([]);
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }

    let socket: WebSocket | null = null;
    let poll: number | null = null;
    let closed = false;
    const base = import.meta.env.VITE_ACTOR_WS || "ws://127.0.0.1:8787";

    const startLog = () => {
      if (closed) return;
      setBackend("log");
      const tick = async () => {
        try {
          const response = await fetch(`/api/candidates/${candidateId}/events`);
          if (!response.ok) return;
          const body = (await response.json()) as { events: PanelEvent[] };
          setEvents(dedupe(body.events ?? []));
        } catch {
          // The room stays on the last events it has.
        }
      };
      void tick();
      poll = window.setInterval(() => void tick(), 1000);
    };

    const giveUp = window.setTimeout(() => {
      if (socket?.readyState === WebSocket.OPEN) return;
      socket?.close();
      startLog();
    }, 3000);

    try {
      socket = new WebSocket(`${base}/actors/${candidateId}/ws`);
    } catch {
      startLog();
      return () => window.clearTimeout(giveUp);
    }

    socket.onopen = () => {
      window.clearTimeout(giveUp);
      setBackend("actor");
      socket?.send(JSON.stringify({ type: "subscribe" }));
    };
    socket.onmessage = (message) => {
      const body = JSON.parse(String(message.data)) as { type?: string; events?: PanelEvent[]; event?: PanelEvent };
      if (body.type === "replay" && body.events) setEvents(dedupe(body.events));
      if (body.type === "event" && body.event) setEvents((current) => dedupe([...current, body.event as PanelEvent]));
    };
    socket.onerror = () => {
      if (socket?.readyState === WebSocket.OPEN) return;
    };

    return () => {
      closed = true;
      window.clearTimeout(giveUp);
      socket?.close();
      if (poll) window.clearInterval(poll);
    };
  }, [candidateId, demo]);

  return { events, phase: phaseFrom(events), backend };
}

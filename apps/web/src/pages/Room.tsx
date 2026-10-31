import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PERSONA_LABEL, REVIEWERS, type PanelEvent, type PanelReport, type Persona, type PersonaReview, type Phase } from "@proofhire/contracts";
import { usePanelEvents } from "../hooks/usePanelEvents";
import { useDemo } from "../App";
import { VerdictChip, personaLabel, tone, verdictLabel } from "../ui";

const STEPS: { id: Phase; label: string }[] = [
  { id: "independent", label: "Independent" },
  { id: "crossexam", label: "Cross-exam" },
  { id: "synthesis", label: "Synthesis" },
  { id: "done", label: "Decision" },
];

export function Room() {
  const { id = "" } = useParams();
  const { demo } = useDemo();
  const { events, phase, backend } = usePanelEvents(id, demo);
  const report = [...events].reverse().find((event) => event.kind === "report")?.payload as PanelReport | undefined;

  useEffect(() => {
    if (report?.candidateId) sessionStorage.setItem(`proofhire-report:${report.candidateId}`, JSON.stringify(report));
  }, [report]);

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Panel room · {backendLabel(backend)}</p>
          <h1 className="mt-2 font-serif text-4xl">The reviewers are in the room</h1>
        </div>
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((step, index) => {
            const current = STEPS.findIndex((item) => item.id === phase);
            const reached = phase !== "idle" && index <= current;
            return (
              <li key={step.id} className={`rounded-full px-3 py-1 text-sm font-semibold ${reached ? "bg-accent text-white" : "bg-card text-muted"}`}>
                {step.label}
              </li>
            );
          })}
        </ol>
      </div>

      {phase === "idle" ? (
        <p className="mt-8 rounded-3xl border border-dashed border-line bg-card px-5 py-8 text-muted">
          Waiting for the panel to start. Reviews will appear in the three seats, then the moderator closes.
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {REVIEWERS.map((persona) => (
          <Lane key={persona} persona={persona} phase={phase} events={events} />
        ))}
      </div>
      <Lane persona="moderator" phase={phase} events={events} wide />

      {report ? <Reveal report={report} candidateId={id} /> : null}
    </main>
  );
}

function Lane({ persona, phase, events, wide }: { persona: Persona; phase: Phase; events: PanelEvent[]; wide?: boolean }) {
  const messages = events.filter((event) => event.kind === "message" && event.persona === persona);
  const review = [...events].reverse().find((event) => event.kind === "review" && event.persona === persona)?.payload as PersonaReview | undefined;
  const notes = events
    .filter((event) => event.kind === "crossexam" && event.persona === persona)
    .flatMap((event) => ((event.payload as { notes?: { targetPersona: Persona; type: string; text: string }[] }).notes ?? []));
  const typing = isTyping(persona, phase, events);

  return (
    <section className={`mt-4 rounded-3xl border border-line bg-card p-4 ${wide ? "lg:col-span-3" : ""}`}>
      <header className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{personaLabel(persona)}</h2>
        {review ? <VerdictChip verdict={review.verdict} /> : null}
      </header>
      <div className="mt-3 grid gap-2">
        {messages.map((event) => (
          <p key={event.seq} className="max-w-xl rounded-2xl rounded-bl-md bg-paper px-3 py-2 text-[15px] leading-snug">
            {(event.payload as { text: string }).text}
          </p>
        ))}
        {review ? <p className="text-sm font-semibold">{review.headline}</p> : null}
        {review?.redFlags.map((flag) => (
          <span key={flag.text} title={flag.evidence} className="w-fit rounded-full bg-bad-bg px-2.5 py-1 text-xs font-semibold text-bad">
            {flag.text}
          </span>
        ))}
        {notes.map((note) => (
          <p key={`${note.targetPersona}-${note.text}`} className="ml-4 rounded-2xl border border-line px-3 py-2 text-sm">
            <span className="font-semibold text-accent">
              {note.type} → {PERSONA_LABEL[note.targetPersona]}
            </span>
            <span className="mt-1 block">{note.text}</span>
          </p>
        ))}
        {typing ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="flex gap-1" aria-hidden>
              <i className="typing-dot" />
              <i className="typing-dot" style={{ animationDelay: "0.15s" }} />
              <i className="typing-dot" style={{ animationDelay: "0.3s" }} />
            </span>
            Writing
          </div>
        ) : null}
        {!typing && messages.length === 0 && !review && persona === "moderator" && phase !== "synthesis" && phase !== "done" ? (
          <p className="text-sm text-muted">Waiting for the three reviews.</p>
        ) : null}
      </div>
    </section>
  );
}

function isTyping(persona: Persona, phase: Phase, events: PanelEvent[]): boolean {
  if (phase === "independent" && persona !== "moderator") {
    return !events.some((event) => event.kind === "review" && event.persona === persona);
  }
  if (phase === "crossexam" && persona !== "moderator") {
    return !events.some((event) => event.kind === "crossexam" && event.persona === persona);
  }
  if (phase === "synthesis" && persona === "moderator") {
    return !events.some((event) => event.kind === "report");
  }
  return false;
}

function Reveal({ report, candidateId }: { report: PanelReport; candidateId: string }) {
  const score = useCountUp(report.panelScore);
  return (
    <section className="mt-6 flex flex-wrap items-end justify-between gap-4 rounded-3xl bg-ink px-6 py-5 text-paper">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-paper/70">Panel score</p>
        <div className="font-serif text-6xl tabular-nums">{score}</div>
        <p className="mt-1 text-lg">{verdictLabel(report.recommendation)}. {report.summary}</p>
      </div>
      <Link to={`/candidates/${candidateId}`} className="rounded-full bg-paper px-4 py-2 font-semibold text-ink">
        Open the HR report
      </Link>
    </section>
  );
}

function useCountUp(target: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 900);
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function backendLabel(backend: string): string {
  if (backend === "replay") return "recorded replay";
  if (backend === "actor") return "live from the panel actor";
  if (backend === "log") return "live from the event log";
  return "connecting";
}

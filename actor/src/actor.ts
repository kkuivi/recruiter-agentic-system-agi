import { Actor, type ActorSocket, Persisted } from "terse-sdk/actor";
import {
  isReviewer,
  REVIEWERS,
  type CaseFile,
  type CrossExamNote,
  type Incoming,
  type MethodResult,
  type Outgoing,
  type PanelEvent,
  type PanelReport,
  type PanelState,
  type Persona,
  type PersonaReview,
  type Phase,
  type ReviewerPersona,
} from "./types";

const ALARM_MS = 90_000;
const VERDICTS = new Set(["advance", "maybe", "reject"]);

type Socket = ActorSocket<{ userId?: string }, Outgoing>;

/**
 * One panel room per candidate. The actor id is the candidate id.
 * Calls run one at a time. The alarm advances a round that stalls for 90 seconds.
 * This actor stores and broadcasts. It does not call a model.
 */
export class PanelRoom extends Actor<{ userId?: string }, Incoming, Outgoing> {
  @Persisted private phase: Phase = "idle";
  @Persisted private caseFile: CaseFile | null = null;
  @Persisted private reviews: Partial<Record<ReviewerPersona, PersonaReview>> = {};
  @Persisted private crossExam: Partial<Record<ReviewerPersona, CrossExamNote[]>> = {};
  @Persisted private report: PanelReport | null = null;
  @Persisted private events: PanelEvent[] = [];
  @Persisted private seq = 0;

  async getState(): Promise<PanelState> {
    return {
      phase: this.phase,
      caseFile: this.caseFile,
      reviews: this.reviews,
      crossExam: this.crossExam,
      report: this.report,
      events: this.events.slice(-200),
    };
  }

  async start(caseFile: CaseFile): Promise<MethodResult> {
    if (!caseFile?.candidateId || !caseFile.job) return { ok: false, error: "case file is incomplete" };
    this.alarm.delete();
    this.phase = "independent";
    this.caseFile = caseFile;
    this.reviews = {};
    this.crossExam = {};
    this.report = null;
    this.events = [];
    this.seq = 0;
    const event = this.#record("phase", undefined, { phase: "independent" });
    this.#arm();
    return { ok: true, phase: this.phase, events: [event] };
  }

  async submitReview(review: PersonaReview): Promise<MethodResult> {
    const error = validateReview(review);
    if (error) return { ok: false, error };
    if (this.phase !== "independent") {
      if (this.reviews[review.persona]) {
        this.reviews = { ...this.reviews, [review.persona]: review };
        return { ok: true, phase: this.phase, events: [] };
      }
      return { ok: false, error: `wrong phase: ${this.phase}` };
    }
    this.reviews = { ...this.reviews, [review.persona]: review };
    const events = [this.#record("review", review.persona, review)];
    if (REVIEWERS.every((persona) => this.reviews[persona])) {
      this.phase = "crossexam";
      events.push(this.#record("phase", undefined, { phase: "crossexam" }));
      this.#arm();
    }
    return { ok: true, phase: this.phase, events };
  }

  async submitCrossExam(persona: ReviewerPersona, notes: CrossExamNote[]): Promise<MethodResult> {
    if (!isReviewer(persona)) return { ok: false, error: "unknown persona" };
    if (!Array.isArray(notes)) return { ok: false, error: "notes must be a list" };
    for (const note of notes) {
      if (!isReviewer(note.persona) || !isReviewer(note.targetPersona)) return { ok: false, error: "unknown persona" };
      if (note.persona !== persona) return { ok: false, error: "note persona does not match submitter" };
      if (!["challenge", "concede", "add"].includes(note.type) || typeof note.text !== "string") {
        return { ok: false, error: "invalid cross-exam note" };
      }
    }
    if (this.phase !== "crossexam") {
      if (this.crossExam[persona]) {
        this.crossExam = { ...this.crossExam, [persona]: notes };
        return { ok: true, phase: this.phase, events: [] };
      }
      return { ok: false, error: `wrong phase: ${this.phase}` };
    }
    this.crossExam = { ...this.crossExam, [persona]: notes };
    const events = [this.#record("crossexam", persona, { persona, notes })];
    if (REVIEWERS.every((name) => this.crossExam[name])) {
      this.phase = "synthesis";
      events.push(this.#record("phase", undefined, { phase: "synthesis" }));
      this.#arm();
    }
    return { ok: true, phase: this.phase, events };
  }

  async postMessage(persona: Persona, text: string): Promise<MethodResult> {
    if (persona !== "moderator" && !isReviewer(persona)) return { ok: false, error: "unknown persona" };
    if (this.phase === "idle") return { ok: false, error: "panel has not started" };
    if (typeof text !== "string" || text.trim() === "") return { ok: false, error: "empty message" };
    const event = this.#record("message", persona, { text: text.trim() });
    return { ok: true, phase: this.phase, events: [event] };
  }

  async submitReport(report: PanelReport): Promise<MethodResult> {
    const error = validateReport(report);
    if (error) return { ok: false, error };
    if (this.phase !== "synthesis" && this.phase !== "done") return { ok: false, error: `wrong phase: ${this.phase}` };
    this.report = report;
    this.phase = "done";
    this.alarm.delete();
    const event = this.#record("report", "moderator", report);
    return { ok: true, phase: this.phase, events: [event] };
  }

  async onAlarm(): Promise<void> {
    if (this.phase === "idle" || this.phase === "done") return;
    if (this.phase === "independent") {
      const reviews = { ...this.reviews };
      for (const persona of REVIEWERS) {
        if (reviews[persona]) continue;
        this.#record("timeout", persona, { persona, phase: "independent" });
        reviews[persona] = emptyReview(persona);
      }
      this.reviews = reviews;
      this.phase = "crossexam";
      this.#record("phase", undefined, { phase: "crossexam" });
      this.#arm();
      return;
    }
    if (this.phase === "crossexam") {
      const notes = { ...this.crossExam };
      for (const persona of REVIEWERS) {
        if (notes[persona]) continue;
        this.#record("timeout", persona, { persona, phase: "crossexam" });
        notes[persona] = [];
      }
      this.crossExam = notes;
      this.phase = "synthesis";
      this.#record("phase", undefined, { phase: "synthesis" });
      this.#arm();
      return;
    }
    this.#record("timeout", "moderator", { persona: "moderator", phase: "synthesis" });
    if (!this.report && this.caseFile) this.report = emptyReport(this.caseFile.candidateId);
    this.phase = "done";
    this.alarm.delete();
    if (this.report) this.#record("report", "moderator", this.report);
  }

  async onConnect(socket: Socket): Promise<void> {
    socket.send({ type: "snapshot", phase: this.phase, events: this.events.slice(-200) });
  }

  async onMessage(socket: Socket, message: Incoming): Promise<void> {
    if (message?.type === "subscribe") {
      socket.send({ type: "snapshot", phase: this.phase, events: this.events.slice(-200) });
    }
  }

  #arm(): void {
    this.alarm.set(Date.now() + ALARM_MS);
  }

  #record(kind: PanelEvent["kind"], persona: Persona | undefined, payload: unknown): PanelEvent {
    this.seq += 1;
    const event: PanelEvent = {
      seq: this.seq,
      at: new Date().toISOString(),
      kind,
      payload,
    };
    if (persona) event.persona = persona;
    const next = [...this.events, event];
    this.events = next.length > 500 ? next.slice(-500) : next;
    this.broadcast({ type: "event", event });
    return event;
  }
}

function validateReview(review: PersonaReview): string | null {
  if (!review || !isReviewer(review.persona)) return "unknown persona";
  if (!VERDICTS.has(review.verdict)) return "invalid verdict";
  if (typeof review.score !== "number" || review.score < 0 || review.score > 100) return "score must be 0 to 100";
  if (typeof review.headline !== "string" || review.headline.trim() === "") return "headline is required";
  for (const list of [review.strengths, review.drawbacks, review.redFlags]) {
    if (!Array.isArray(list)) return "findings must be lists";
    for (const finding of list) {
      if (typeof finding?.text !== "string" || typeof finding?.evidence !== "string") return "finding needs text and evidence";
    }
  }
  return null;
}

function validateReport(report: PanelReport): string | null {
  if (!report?.candidateId) return "report is incomplete";
  if (!VERDICTS.has(report.recommendation)) return "invalid recommendation";
  if (typeof report.panelScore !== "number") return "panel score is required";
  if (!Array.isArray(report.reviews) || !Array.isArray(report.crossExam)) return "report lists are required";
  return null;
}

function emptyReview(persona: ReviewerPersona): PersonaReview {
  return {
    persona,
    verdict: "maybe",
    score: 0,
    headline: "Timed out before submitting a review.",
    strengths: [],
    drawbacks: [],
    redFlags: [],
  };
}

function emptyReport(candidateId: string): PanelReport {
  return {
    candidateId,
    panelScore: 0,
    recommendation: "maybe",
    summary: "The moderator timed out before filing a report.",
    consensus: [],
    disagreements: [],
    questionsForHR: [],
    reviews: [],
    crossExam: [],
    completedAt: new Date().toISOString(),
  };
}

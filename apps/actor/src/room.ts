import {
  isReviewer,
  REVIEWERS,
  type CaseFile,
  type CrossExamNote,
  type PanelEvent,
  type PanelReport,
  type Persona,
  type PersonaReview,
  type Phase,
  type ReviewerPersona,
} from "@proofhire/contracts";

type MethodResult = { ok: true; events: PanelEvent[]; phase: Phase } | { ok: false; error: string };

interface PersistedState {
  phase: Phase;
  caseFile: CaseFile | null;
  reviews: Partial<Record<ReviewerPersona, PersonaReview>>;
  crossExam: Partial<Record<ReviewerPersona, CrossExamNote[]>>;
  report: PanelReport | null;
  events: PanelEvent[];
  seq: number;
}

const VERDICTS = new Set(["advance", "maybe", "reject"]);

export class PanelRoom {
  private phase: Phase = "idle";
  private caseFile: CaseFile | null = null;
  private reviews: Partial<Record<ReviewerPersona, PersonaReview>> = {};
  private crossExam: Partial<Record<ReviewerPersona, CrossExamNote[]>> = {};
  private report: PanelReport | null = null;
  private events: PanelEvent[] = [];
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(event: PanelEvent) => void>();

  constructor(private readonly alarmMs = 90_000) {}

  onEvent(listener: (event: PanelEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  enqueue<T>(fn: () => T): Promise<T> {
    const run = this.queue.then(() => fn());
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  hydrate(state: PersistedState): void {
    this.phase = state.phase;
    this.caseFile = state.caseFile;
    this.reviews = state.reviews ?? {};
    this.crossExam = state.crossExam ?? {};
    this.report = state.report;
    this.events = state.events ?? [];
    this.seq = state.seq ?? this.events.at(-1)?.seq ?? 0;
    if (this.phase !== "idle" && this.phase !== "done") this.scheduleAlarm();
  }

  snapshot(): PersistedState {
    return {
      phase: this.phase,
      caseFile: this.caseFile,
      reviews: this.reviews,
      crossExam: this.crossExam,
      report: this.report,
      events: this.events,
      seq: this.seq,
    };
  }

  getState() {
    return {
      phase: this.phase,
      caseFile: this.caseFile,
      reviews: this.reviews,
      crossExam: this.crossExam,
      report: this.report,
      events: this.events.slice(-200),
    };
  }

  start(caseFile: CaseFile): MethodResult {
    if (!caseFile?.candidateId || !caseFile.job) return { ok: false, error: "case file is incomplete" };
    this.clearAlarm();
    this.phase = "idle";
    this.caseFile = caseFile;
    this.reviews = {};
    this.crossExam = {};
    this.report = null;
    this.events = [];
    this.seq = 0;
    this.phase = "independent";
    const event = this.emit("phase", undefined, { phase: "independent" });
    this.scheduleAlarm();
    return { ok: true, events: [event], phase: this.phase };
  }

  submitReview(review: PersonaReview): MethodResult {
    const error = validateReview(review);
    if (error) return { ok: false, error };
    if (this.phase !== "independent") {
      if (this.reviews[review.persona]) {
        this.reviews[review.persona] = review;
        return { ok: true, events: [], phase: this.phase };
      }
      return { ok: false, error: `wrong phase: ${this.phase}` };
    }
    this.reviews[review.persona] = review;
    const events = [this.emit("review", review.persona, review)];
    if (REVIEWERS.every((persona) => this.reviews[persona])) {
      this.phase = "crossexam";
      events.push(this.emit("phase", undefined, { phase: "crossexam" }));
      this.scheduleAlarm();
    }
    return { ok: true, events, phase: this.phase };
  }

  submitCrossExam(persona: ReviewerPersona, notes: CrossExamNote[]): MethodResult {
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
        this.crossExam[persona] = notes;
        return { ok: true, events: [], phase: this.phase };
      }
      return { ok: false, error: `wrong phase: ${this.phase}` };
    }
    this.crossExam[persona] = notes;
    const events = [this.emit("crossexam", persona, { persona, notes })];
    if (REVIEWERS.every((name) => this.crossExam[name])) {
      this.phase = "synthesis";
      events.push(this.emit("phase", undefined, { phase: "synthesis" }));
      this.scheduleAlarm();
    }
    return { ok: true, events, phase: this.phase };
  }

  postMessage(persona: Persona, text: string): MethodResult {
    if (persona !== "moderator" && !isReviewer(persona)) return { ok: false, error: "unknown persona" };
    if (this.phase === "idle") return { ok: false, error: "panel has not started" };
    if (typeof text !== "string" || text.trim() === "") return { ok: false, error: "empty message" };
    const event = this.emit("message", persona, { text: text.trim() });
    return { ok: true, events: [event], phase: this.phase };
  }

  submitReport(report: PanelReport): MethodResult {
    const error = validateReport(report);
    if (error) return { ok: false, error };
    if (this.phase !== "synthesis" && this.phase !== "done") return { ok: false, error: `wrong phase: ${this.phase}` };
    this.report = report;
    this.phase = "done";
    this.clearAlarm();
    const event = this.emit("report", "moderator", report);
    return { ok: true, events: [event], phase: this.phase };
  }

  applyAlarm(): MethodResult {
    if (this.phase === "idle" || this.phase === "done") return { ok: true, events: [], phase: this.phase };
    const events: PanelEvent[] = [];
    if (this.phase === "independent") {
      for (const persona of REVIEWERS) {
        if (this.reviews[persona]) continue;
        events.push(this.emit("timeout", persona, { persona, phase: "independent" }));
        this.reviews[persona] = emptyReview(persona);
      }
      this.phase = "crossexam";
      events.push(this.emit("phase", undefined, { phase: "crossexam" }));
      this.scheduleAlarm();
    } else if (this.phase === "crossexam") {
      for (const persona of REVIEWERS) {
        if (this.crossExam[persona]) continue;
        events.push(this.emit("timeout", persona, { persona, phase: "crossexam" }));
        this.crossExam[persona] = [];
      }
      this.phase = "synthesis";
      events.push(this.emit("phase", undefined, { phase: "synthesis" }));
      this.scheduleAlarm();
    } else if (this.phase === "synthesis") {
      events.push(this.emit("timeout", "moderator", { persona: "moderator", phase: "synthesis" }));
      if (!this.report && this.caseFile) this.report = emptyReport(this.caseFile.candidateId);
      this.phase = "done";
      this.clearAlarm();
      if (this.report) events.push(this.emit("report", "moderator", this.report));
    }
    return { ok: true, events, phase: this.phase };
  }

  stop(): void {
    this.clearAlarm();
  }

  private scheduleAlarm(): void {
    this.clearAlarm();
    this.timer = setTimeout(() => {
      void this.enqueue(() => this.applyAlarm());
    }, this.alarmMs);
    this.timer.unref?.();
  }

  private clearAlarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(kind: PanelEvent["kind"], persona: Persona | undefined, payload: unknown): PanelEvent {
    this.seq += 1;
    const event: PanelEvent = {
      seq: this.seq,
      at: new Date().toISOString(),
      kind,
      payload,
    };
    if (persona) event.persona = persona;
    this.events.push(event);
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    for (const listener of this.listeners) listener(event);
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

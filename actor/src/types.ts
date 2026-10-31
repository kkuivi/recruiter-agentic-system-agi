export const REVIEWERS = ["project_manager", "staff_engineer", "associate_engineer"] as const;

export type ReviewerPersona = (typeof REVIEWERS)[number];
export type Persona = ReviewerPersona | "moderator";
export type Verdict = "advance" | "maybe" | "reject";
export type Phase = "idle" | "independent" | "crossexam" | "synthesis" | "done";

export interface Finding {
  text: string;
  evidence: string;
}

export interface PersonaReview {
  persona: ReviewerPersona;
  verdict: Verdict;
  score: number;
  headline: string;
  strengths: Finding[];
  drawbacks: Finding[];
  redFlags: Finding[];
}

export interface CrossExamNote {
  persona: ReviewerPersona;
  targetPersona: ReviewerPersona;
  type: "challenge" | "concede" | "add";
  text: string;
}

export interface PanelReport {
  candidateId: string;
  panelScore: number;
  recommendation: Verdict;
  summary: string;
  consensus: string[];
  disagreements: string[];
  questionsForHR: string[];
  reviews: PersonaReview[];
  crossExam: CrossExamNote[];
  completedAt: string;
}

export interface PanelEvent {
  seq: number;
  at: string;
  kind: "phase" | "review" | "crossexam" | "message" | "timeout" | "report";
  persona?: Persona;
  payload: unknown;
}

export interface CaseFile {
  candidateId: string;
  candidateName: string;
  job: {
    title: string;
    description: string;
    personaExpectations?: Partial<Record<ReviewerPersona, string>>;
    interviewerRoles?: Partial<Record<ReviewerPersona, string>>;
  };
  resumeText: string;
  projects: unknown[];
  repoReports: unknown[];
  score: {
    candidateId: string;
    relevance: number;
    authenticity: number;
    fit: number;
    rank: number;
    summary: string;
  };
}

export interface PanelState {
  phase: Phase;
  caseFile: CaseFile | null;
  reviews: Partial<Record<ReviewerPersona, PersonaReview>>;
  crossExam: Partial<Record<ReviewerPersona, CrossExamNote[]>>;
  report: PanelReport | null;
  events: PanelEvent[];
}

export type MethodResult = { ok: true; phase: Phase; events: PanelEvent[] } | { ok: false; error: string };

export type Incoming = { type: "subscribe" };

export type Outgoing =
  | { type: "event"; event: PanelEvent }
  | { type: "snapshot"; phase: Phase; events: PanelEvent[] };

export function isReviewer(value: string): value is ReviewerPersona {
  return (REVIEWERS as readonly string[]).includes(value);
}

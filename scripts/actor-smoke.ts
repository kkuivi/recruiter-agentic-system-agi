import { PanelRoom } from "../apps/actor/src/room.ts";
import type { CaseFile, PersonaReview, ReviewerPersona, Verdict } from "../packages/contracts/src/index.ts";

const caseFile: CaseFile = {
  candidateId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
  candidateName: "Alex Rivera",
  job: {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Senior Full-Stack Engineer",
    description: "Realtime data platform",
    personaExpectations: {
      project_manager: "Own the work.",
      staff_engineer: "Show the code.",
      associate_engineer: "Be readable.",
    },
  },
  resumeText: "Streamline, Jan 2024 – Mar 2025",
  projects: [],
  repoReports: [],
  score: {
    candidateId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    relevance: 42,
    authenticity: 5,
    fit: 24,
    rank: 3,
    summary: "Scaffold.",
  },
};

function review(persona: ReviewerPersona, verdict: Verdict = "reject"): PersonaReview {
  return {
    persona,
    verdict,
    score: 20,
    headline: `${persona} review`,
    strengths: [{ text: "Owns the repo.", evidence: "owner match" }],
    drawbacks: [{ text: "Thin history.", evidence: "two commits" }],
    redFlags: [{ text: "Unsupported claim.", evidence: "no kafka client" }],
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const room = new PanelRoom(60_000);
const started = room.start(caseFile);
assert(started.ok && started.phase === "independent", "start moves to independent");
assert(room.submitReview(review("project_manager")).ok, "pm review");
assert(room.submitReview(review("project_manager", "maybe")).ok, "pm review is idempotent");
assert(room.getState().phase === "independent", "one reviewer does not advance the phase");
assert(room.submitReview(review("staff_engineer")).ok, "staff review");
const third = room.submitReview(review("associate_engineer", "maybe"));
assert(third.ok && third.phase === "crossexam", "third review opens cross-exam");
const phases = room.getState().events.filter((event) => event.kind === "phase").map((event) => (event.payload as { phase: string }).phase);
assert(phases.join(",") === "independent,crossexam", "phase events so far");

assert(room.submitCrossExam("project_manager", []).ok, "pm notes");
assert(room.submitCrossExam("staff_engineer", []).ok, "staff notes");
const cross = room.submitCrossExam("associate_engineer", [
  {
    persona: "associate_engineer",
    targetPersona: "staff_engineer",
    type: "concede",
    text: "Agreed.",
  },
]);
assert(cross.ok && cross.phase === "synthesis", "cross-exam completes");
const report = room.submitReport({
  candidateId: caseFile.candidateId,
  panelScore: 22,
  recommendation: "reject",
  summary: "Reject.",
  consensus: ["No pipeline."],
  disagreements: [],
  questionsForHR: ["Where is the consumer?"],
  reviews: [review("project_manager"), review("staff_engineer"), review("associate_engineer", "maybe")],
  crossExam: [],
  completedAt: new Date().toISOString(),
});
assert(report.ok && report.phase === "done", "report closes the panel");
const seqs = room.getState().events.map((event) => event.seq);
assert(seqs.every((seq, index) => seq === index + 1), "event sequence is contiguous");

const timed = new PanelRoom(40);
timed.start(caseFile);
timed.submitReview(review("project_manager"));
await Bun.sleep(180);
const mid = timed.getState();
assert(mid.phase !== "independent", "alarm advances a stalled round");
assert(mid.events.some((event) => event.kind === "timeout"), "alarm records timeouts");
room.stop();
timed.stop();

console.log("actor smoke passed");

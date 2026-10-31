export const REVIEWERS = ["project_manager", "staff_engineer", "associate_engineer"] as const;

export type ReviewerPersona = (typeof REVIEWERS)[number];
export type Persona = ReviewerPersona | "moderator";
export type Verdict = "advance" | "maybe" | "reject";
export type Phase = "idle" | "independent" | "crossexam" | "synthesis" | "done";
export type CandidateStatus =
  | "new"
  | "screening"
  | "screened"
  | "panel_running"
  | "panel_done";

export interface JobSpec {
  id: string;
  title: string;
  description: string;
  personaExpectations: Record<ReviewerPersona, string>;
  interviewerRoles?: Partial<Record<ReviewerPersona, string>>;
}

export interface GithubRepoSummary {
  name: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  fork: boolean;
  pushedAt: string | null;
}

export interface GithubProfile {
  username: string;
  htmlUrl: string;
  name: string | null;
  bio: string | null;
  publicRepos: number;
  followers: number;
  repos: GithubRepoSummary[];
}

export interface CandidateInput {
  id: string;
  name: string;
  githubUsername: string;
  resumeText: string;
}

export interface ProjectClaim {
  name: string;
  description: string;
  claimedTech: string[];
  claimedFeatures: string[];
  repoUrl: string | null;
  claimedDates: string | null;
}

export interface StepResult {
  attempted: boolean;
  ok: boolean;
  logTail: string;
}

export interface ClaimCheck {
  claim: string;
  verdict: "supported" | "partial" | "unsupported";
  evidence: string;
}

export interface RepoReport {
  repoUrl: string;
  exists: boolean;
  isFork: boolean;
  ownerMatchesCandidate: boolean;
  commitCount: number;
  candidateCommitCount: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
  activeDays: number;
  largestCommitShare: number;
  linesOfCode: number;
  languages: Record<string, number>;
  hasTests: boolean;
  install: StepResult;
  build: StepResult;
  test: StepResult;
  claimChecks: ClaimCheck[];
  flags: string[];
  authenticityScore: number;
}

export interface CandidateScore {
  candidateId: string;
  relevance: number;
  authenticity: number;
  fit: number;
  rank: number;
  summary: string;
}

export interface CaseFile {
  candidateId: string;
  candidateName: string;
  job: JobSpec;
  resumeText: string;
  projects: ProjectClaim[];
  repoReports: RepoReport[];
  score: CandidateScore;
}

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

export { extractGithubUsername, githubRepoUrls } from "./github.ts";

export function isReviewer(value: string): value is ReviewerPersona {
  return (REVIEWERS as readonly string[]).includes(value);
}

export const PERSONA_LABEL: Record<Persona, string> = {
  project_manager: "Project Manager",
  staff_engineer: "Staff Engineer",
  associate_engineer: "Associate Engineer",
  moderator: "Moderator",
};

export const FLAG_LABEL: Record<string, string> = {
  repo_missing: "Repo missing",
  fork_no_work: "Fork, no commits",
  not_owner: "Not the owner",
  few_commits: "Three commits or fewer",
  single_dump: "Single dump commit",
  one_day: "Active one day",
  build_fails: "Build failed",
  install_fails: "Install failed",
  claim_unsupported: "Unsupported claim",
};

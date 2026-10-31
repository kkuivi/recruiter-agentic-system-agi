import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  CandidateInput,
  CandidateScore,
  CandidateStatus,
  CaseFile,
  GithubProfile,
  JobSpec,
  PanelEvent,
  PanelReport,
  ProjectClaim,
  RepoReport,
} from "@proofhire/contracts";

const SEED_VERSION = 1;
const dbPath = path.resolve(process.cwd(), "data/db.json");

export interface StoredCandidate extends CandidateInput {
  jobId: string;
  status: CandidateStatus;
}

interface Database {
  seedVersion: number;
  job: JobSpec;
  candidates: StoredCandidate[];
  projects: Record<string, ProjectClaim[]>;
  reports: Record<string, RepoReport[]>;
  scores: Record<string, CandidateScore>;
  panels: Record<string, PanelReport>;
  events: Record<string, PanelEvent[]>;
  profiles?: Record<string, GithubProfile>;
}

let db: Database;

export function initStore(seed: Database): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  if (exists(dbPath)) {
    try {
      const parsed = JSON.parse(readFileSync(dbPath, "utf8")) as Database;
      if (parsed.seedVersion === SEED_VERSION && parsed.job?.id) {
        db = parsed;
        return;
      }
    } catch {
      // Replace an unreadable store with the seed.
    }
  }
  db = seed;
  persist();
}

export function snapshot(): Database {
  return db;
}

export function currentJob(): JobSpec {
  return db.job;
}

export function updateJob(
  patch: Partial<Pick<JobSpec, "title" | "description">> & {
    personaExpectations?: JobSpec["personaExpectations"];
    interviewerRoles?: JobSpec["interviewerRoles"];
  },
): JobSpec {
  db.job = {
    ...db.job,
    ...patch,
    personaExpectations: patch.personaExpectations ?? db.job.personaExpectations,
    interviewerRoles: patch.interviewerRoles ?? db.job.interviewerRoles,
  };
  persist();
  return db.job;
}

export function addCandidate(input: { id?: string; name: string; resumeText: string; githubUsername?: string }): StoredCandidate {
  const id = input.id && !candidate(input.id) ? input.id : crypto.randomUUID();
  const row: StoredCandidate = {
    id,
    name: input.name.trim(),
    githubUsername: input.githubUsername?.trim() || "",
    resumeText: input.resumeText,
    jobId: db.job.id,
    status: "new",
  };
  db.candidates.push(row);
  persist();
  return row;
}

export function updateCandidate(
  id: string,
  patch: { name?: string; resumeText?: string; githubUsername?: string },
): StoredCandidate | undefined {
  const row = candidate(id);
  if (!row) return undefined;
  const resumeChanged = typeof patch.resumeText === "string" && patch.resumeText !== row.resumeText;
  if (typeof patch.name === "string") row.name = patch.name.trim();
  if (typeof patch.resumeText === "string") row.resumeText = patch.resumeText;
  if (typeof patch.githubUsername === "string") row.githubUsername = patch.githubUsername.trim();
  if (resumeChanged) {
    row.status = "new";
    clearScreen(id);
  }
  persist();
  return row;
}

export function removeCandidate(id: string): void {
  db.candidates = db.candidates.filter((item) => item.id !== id);
  clearScreen(id);
  delete db.panels[id];
  delete db.events[id];
  if (db.profiles) delete db.profiles[id];
  persist();
}

export function setGithubUsername(id: string, githubUsername: string): void {
  const row = candidate(id);
  if (!row) return;
  row.githubUsername = githubUsername;
  persist();
}

export function saveProfile(id: string, profile: GithubProfile): void {
  if (!db.profiles) db.profiles = {};
  db.profiles[id] = profile;
  persist();
}

export function profileOf(id: string): GithubProfile | null {
  return db.profiles?.[id] ?? null;
}

export function listCandidates(): StoredCandidate[] {
  return db.candidates;
}

export function candidate(id: string): StoredCandidate | undefined {
  return db.candidates.find((item) => item.id === id);
}

export function setStatus(id: string, status: CandidateStatus): void {
  const row = candidate(id);
  if (!row) return;
  row.status = status;
  persist();
}

export function projectsOf(id: string): ProjectClaim[] {
  return db.projects[id] ?? [];
}

export function reportsOf(id: string): RepoReport[] {
  return db.reports[id] ?? [];
}

export function scoreOf(id: string): CandidateScore | undefined {
  return db.scores[id];
}

export function panelOf(id: string): PanelReport | undefined {
  return db.panels[id];
}

export function eventsOf(id: string): PanelEvent[] {
  return db.events[id] ?? [];
}

export function saveScreen(id: string, projects: ProjectClaim[], reports: RepoReport[], score: CandidateScore): void {
  db.projects[id] = projects;
  db.reports[id] = reports;
  db.scores[id] = score;
  persist();
}

export function setRank(id: string, rank: number): void {
  const score = db.scores[id];
  if (!score) return;
  score.rank = rank;
  persist();
}

export function clearEvents(id: string): void {
  db.events[id] = [];
  persist();
}

export function addEvent(id: string, event: PanelEvent): void {
  const list = db.events[id] ?? [];
  if (list.some((item) => item.seq === event.seq)) return;
  list.push(event);
  list.sort((a, b) => a.seq - b.seq);
  db.events[id] = list;
  persist();
}

export function savePanel(report: PanelReport): void {
  db.panels[report.candidateId] = report;
  const row = candidate(report.candidateId);
  if (row) row.status = "panel_done";
  persist();
}

export function caseFile(id: string): CaseFile | null {
  const row = candidate(id);
  const score = scoreOf(id);
  if (!row || !score) return null;
  return {
    candidateId: row.id,
    candidateName: row.name,
    job: db.job,
    resumeText: row.resumeText,
    projects: projectsOf(id),
    repoReports: reportsOf(id),
    score,
  };
}

function clearScreen(id: string): void {
  delete db.projects[id];
  delete db.reports[id];
  delete db.scores[id];
  if (db.profiles) delete db.profiles[id];
}

function persist(): void {
  writeFileSync(dbPath, JSON.stringify(db));
}

function exists(file: string): boolean {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

export function emptyCollections(): Pick<Database, "projects" | "reports" | "scores" | "panels" | "events"> {
  return { projects: {}, reports: {}, scores: {}, panels: {}, events: {} };
}

export const seedVersion = SEED_VERSION;

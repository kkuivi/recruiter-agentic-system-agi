import type { CandidateScore, GithubProfile, JobSpec, PanelReport, ProjectClaim, RepoReport, Verdict } from "@proofhire/contracts";
import { offlineBoard, offlineCandidate, offlineCurrent } from "./offline";

export interface RosterCandidate {
  id: string;
  name: string;
  githubUsername: string;
  resumeText: string;
  status: string;
}

export interface BoardCandidate {
  id: string;
  name: string;
  githubUsername: string;
  status: string;
  rank: number | null;
  fit: number | null;
  relevance: number | null;
  authenticity: number | null;
  summary: string | null;
  flags: string[];
  recommendation: Verdict | null;
  panelScore: number | null;
  projectsNamed?: number;
  reposFound?: number;
}

export interface Board {
  job: JobSpec;
  candidates: BoardCandidate[];
}

export interface CandidateDetail {
  candidate: RosterCandidate & { jobId?: string };
  job: JobSpec;
  projects: ProjectClaim[];
  reports: RepoReport[];
  score: CandidateScore | null;
  panel: PanelReport | null;
  profile?: GithubProfile | null;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function loadCurrent(demo: boolean): Promise<{ job: JobSpec; candidates: RosterCandidate[] }> {
  try {
    return await getJson("/api/jobs/current");
  } catch (error) {
    if (demo) return offlineCurrent();
    throw error;
  }
}

export async function loadBoard(jobId: string, demo: boolean): Promise<Board> {
  try {
    return await getJson(`/api/jobs/${jobId}/board`);
  } catch (error) {
    if (demo) return offlineBoard();
    throw error;
  }
}

export async function loadCandidate(id: string, demo: boolean): Promise<CandidateDetail> {
  try {
    return await getJson(`/api/candidates/${id}`);
  } catch (error) {
    if (demo) {
      const offline = offlineCandidate(id);
      if (offline) return offline;
    }
    throw error;
  }
}

export async function saveJob(job: JobSpec): Promise<void> {
  const response = await fetch(`/api/jobs/${job.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: job.title,
      description: job.description,
      personaExpectations: job.personaExpectations,
      interviewerRoles: job.interviewerRoles,
    }),
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function createCandidate(jobId: string, draft: { id: string; name: string; resumeText: string }): Promise<void> {
  const response = await fetch(`/api/jobs/${jobId}/candidates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function updateCandidate(id: string, draft: { name: string; resumeText: string }): Promise<void> {
  const response = await fetch(`/api/candidates/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function deleteCandidate(id: string): Promise<void> {
  const response = await fetch(`/api/candidates/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await response.text());
}

export async function screenCandidate(id: string): Promise<void> {
  const response = await fetch(`/api/candidates/${id}/screen`, { method: "POST" });
  if (!response.ok) throw new Error(await readError(response));
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // The body is already plain text.
  }
  return text || `Request failed (${response.status})`;
}

export async function screenJob(jobId: string): Promise<void> {
  const response = await fetch(`/api/jobs/${jobId}/screen`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function runPanel(candidateId: string): Promise<void> {
  const response = await fetch(`/api/candidates/${candidateId}/panel`, { method: "POST" });
  if (!response.ok) throw new Error(await response.text());
}

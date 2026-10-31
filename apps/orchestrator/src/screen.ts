import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { analyzeRepo, fetchGithubProfile, matchProjectRepo } from "@proofhire/forensics";
import { aggregateFit } from "@proofhire/forensics/score";
import { extractGithubUsername, githubRepoUrls, type ProjectClaim, type RepoReport } from "@proofhire/contracts";
import { startActor, startPanelService } from "./actor.ts";
import { extractGithubLogin, extractProjects, hasLlmKey, scoreRelevance } from "./llm.ts";
import {
  candidate,
  caseFile,
  clearEvents,
  currentJob,
  listCandidates,
  saveProfile,
  saveScreen,
  setGithubUsername,
  setRank,
  setStatus,
  scoreOf,
} from "./store.ts";

interface ScreenFixture {
  candidateId: string;
  relevance: number;
  summary: string;
  projects: ProjectClaim[];
  reports: RepoReport[];
}

const fixtures = new Map<string, ScreenFixture>();
const seedResumes = new Map<string, string>();

function loadFixtures(): void {
  if (fixtures.size) return;
  const dir = path.resolve(process.cwd(), "seed/fixtures/screens");
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const fixture = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as ScreenFixture;
    fixtures.set(fixture.candidateId, fixture);
  }
}

function loadSeedResumes(): void {
  if (seedResumes.size) return;
  const dir = path.resolve(process.cwd(), "seed/candidates");
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const input = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as { id?: string; resumeText?: string };
    if (input.id && typeof input.resumeText === "string") seedResumes.set(input.id, input.resumeText);
  }
}

export async function screenCandidate(candidateId: string): Promise<void> {
  const row = candidate(candidateId);
  if (!row) throw new Error("candidate not found");
  const previous = row.status === "panel_done" ? "panel_done" : row.status === "screened" ? "screened" : "new";
  setStatus(candidateId, "screening");
  loadFixtures();
  loadSeedResumes();
  const useFixtures = process.env.USE_FIXTURES !== "false";
  const fixture = fixtures.get(candidateId);
  const resumeUnchanged = !seedResumes.has(candidateId) || seedResumes.get(candidateId) === row.resumeText;

  let projects: ProjectClaim[];
  let reports: RepoReport[];
  let relevance: number;
  let summary: string;

  try {
  if (useFixtures && fixture && resumeUnchanged) {
    projects = fixture.projects;
    reports = fixture.reports;
    relevance = fixture.relevance;
    summary = fixture.summary;
  } else {
    if (!hasLlmKey()) throw new Error("Set LLM_API_KEY before screening a resume that is not in the demo set.");
    const screened = await screenResume(candidateId, row.resumeText, row.githubUsername);
    projects = screened.projects;
    reports = screened.reports;
    relevance = screened.relevance;
    summary = screened.summary;
  }
  } catch (error) {
    setStatus(candidateId, previous);
    throw error;
  }

  const agg = aggregateFit(relevance, reports);
  const fit = agg.reports.some((report) => report.exists) ? agg.fit : Math.min(agg.fit, 40);
  saveScreen(candidateId, projects, agg.reports, {
    candidateId,
    relevance,
    authenticity: agg.authenticity,
    fit,
    rank: scoreOf(candidateId)?.rank ?? 0,
    summary,
  });
  setStatus(candidateId, previous === "panel_done" ? "panel_done" : "screened");
}

async function screenResume(
  candidateId: string,
  resumeText: string,
  knownUsername: string,
): Promise<{ projects: ProjectClaim[]; reports: RepoReport[]; relevance: number; summary: string }> {
  let username = extractGithubUsername(resumeText) || "";
  if (!username) username = (await extractGithubLogin(resumeText)) || "";
  if (!username && knownUsername && resumeText.toLowerCase().includes(knownUsername.toLowerCase())) username = knownUsername;
  if (username) setGithubUsername(candidateId, username);

  const profile = username ? await fetchGithubProfile(username) : null;
  if (profile) saveProfile(candidateId, profile);

  const extracted = (await extractProjects(resumeText)).map(cleanProject);
  const projects = mergeResumeRepos(resumeText, extracted).map((project) => ({
    ...project,
    repoUrl: matchProjectRepo(project, profile),
  }));
  const reports = await mapPool(projects, 4, (project) =>
    analyzeRepo({
      repoUrl: project.repoUrl,
      candidateGithubUsername: username,
      claim: project,
    }),
  );
  const scored = await scoreRelevance(currentJob().description, projects, reports, profile);
  const summary = profile
    ? scored.summary
    : username
      ? `${scored.summary} GitHub user @${username} was not found.`
      : `${scored.summary} No GitHub account was written on the resume.`;
  return { projects, reports, relevance: scored.relevance, summary: summary.trim() };
}

function cleanProject(project: ProjectClaim): ProjectClaim {
  return {
    name: String(project.name || "Untitled project"),
    description: String(project.description || ""),
    claimedTech: Array.isArray(project.claimedTech) ? project.claimedTech.map(String) : [],
    claimedFeatures: Array.isArray(project.claimedFeatures) ? project.claimedFeatures.map(String) : [],
    repoUrl: project.repoUrl ? String(project.repoUrl) : null,
    claimedDates: project.claimedDates ? String(project.claimedDates) : null,
  };
}

function mergeResumeRepos(resumeText: string, projects: ProjectClaim[]): ProjectClaim[] {
  const merged = [...projects];
  const seen = new Set(merged.map((project) => (project.repoUrl || "").toLowerCase()).filter(Boolean));
  for (const repo of githubRepoUrls(resumeText)) {
    if (seen.has(repo.url.toLowerCase())) continue;
    seen.add(repo.url.toLowerCase());
    merged.push({
      name: repo.repo,
      description: "Repository linked from the resume.",
      claimedTech: [],
      claimedFeatures: [],
      repoUrl: repo.url,
      claimedDates: null,
    });
  }
  return merged;
}

export function rankJob(jobId: string): void {
  const ranked = listCandidates()
    .filter((row) => row.jobId === jobId)
    .map((row) => scoreOf(row.id))
    .filter((score): score is NonNullable<typeof score> => Boolean(score))
    .sort((a, b) => b.fit - a.fit || a.candidateId.localeCompare(b.candidateId));
  ranked.forEach((score, index) => setRank(score.candidateId, index + 1));
}

export async function screenJob(jobId: string, startPanels: boolean): Promise<void> {
  const rows = listCandidates().filter((row) => row.jobId === jobId);
  await mapPool(rows, 5, async (row) => {
    await screenCandidate(row.id);
  });
  rankJob(jobId);
  const ranked = listCandidates()
    .filter((row) => row.jobId === jobId)
    .map((row) => scoreOf(row.id))
    .filter((score): score is NonNullable<typeof score> => Boolean(score))
    .sort((a, b) => a.rank - b.rank);
  if (startPanels) {
    for (const score of ranked.slice(0, 3)) {
      await startPanel(score.candidateId);
    }
  }
}

export async function startPanel(candidateId: string): Promise<void> {
  const row = candidate(candidateId);
  if (!row) throw new Error("candidate not found");
  if (row.status === "panel_running") return;
  const file = caseFile(candidateId);
  if (!file) throw new Error("candidate has not been screened");
  clearEvents(candidateId);
  await startActor(candidateId, file);
  await startPanelService(candidateId);
  setStatus(candidateId, "panel_running");
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

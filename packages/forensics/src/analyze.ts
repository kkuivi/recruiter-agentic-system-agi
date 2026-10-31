import type { ProjectClaim, RepoReport } from "@proofhire/contracts";
import { checkClaims } from "./claims.ts";
import { github, GithubError, parseGithubRepo, type GhRepo } from "./github.ts";
import { normalizeReport, skippedStep } from "./score.ts";

export interface AnalyzeInput {
  repoUrl: string | null;
  candidateGithubUsername: string;
  claim: ProjectClaim;
}

interface RepoMeta {
  fork: boolean;
  default_branch: string;
  owner: { login: string };
}

interface CommitListItem {
  sha: string;
  author: { login?: string } | null;
  commit: { author: { date?: string } | null };
}

interface CommitDetail {
  stats?: { additions?: number };
}

interface TreeResponse {
  tree?: { path?: string; type?: string; size?: number }[];
}

interface ReadmeResponse {
  content?: string;
  encoding?: string;
}

export async function analyzeRepo(input: AnalyzeInput): Promise<RepoReport> {
  if (!input.repoUrl) return missingReport(null);
  const parsed = parseGithubRepo(input.repoUrl);
  if (!parsed) return missingReport(input.repoUrl);

  try {
    const meta = await github<RepoMeta>(`/repos/${parsed.owner}/${parsed.repo}`);
    if (meta.status === 404) return missingReport(input.repoUrl);
    if (meta.status !== 200 || !meta.data?.owner) {
      throw new GithubError(`GitHub repo lookup failed (${meta.status}).`, meta.status);
    }

    const commits = await listCommits(parsed);
    const dates = commits
      .map((commit) => commit.commit.author?.date)
      .filter((date): date is string => Boolean(date))
      .sort();
    const username = input.candidateGithubUsername.toLowerCase();
    const candidateCommitCount = commits.filter((commit) => commit.author?.login?.toLowerCase() === username).length;
    const activeDays = new Set(dates.map((date) => date.slice(0, 10))).size;
    const largestCommitShare = await largestShare(parsed, commits);
    const languages = await languageMap(parsed);
    const corpus = await readCorpus(parsed, meta.data.default_branch || "HEAD");
    const claimChecks = await checkClaims(input.claim, corpus.text);
    const bytes = Object.values(languages).reduce((sum, value) => sum + value, 0);

    const report: RepoReport = {
      repoUrl: input.repoUrl,
      exists: true,
      isFork: Boolean(meta.data.fork),
      ownerMatchesCandidate: meta.data.owner.login.toLowerCase() === username,
      commitCount: commits.length,
      candidateCommitCount,
      firstCommitAt: dates[0] ?? null,
      lastCommitAt: dates[dates.length - 1] ?? null,
      activeDays,
      largestCommitShare,
      linesOfCode: corpus.lines || Math.round(bytes / 45),
      languages,
      hasTests: corpus.hasTests,
      // Install, build, and test run inside a Superserve sandbox when that SDK is confirmed.
      // Without it, git signals and claim checks come from the GitHub API, which is the planned fallback.
      install: skippedStep(),
      build: skippedStep(),
      test: skippedStep(),
      claimChecks,
      flags: [],
      authenticityScore: 0,
    };
    return normalizeReport(report);
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return missingReport(input.repoUrl);
    throw error;
  }
}

export function missingReport(repoUrl: string | null): RepoReport {
  return normalizeReport({
    repoUrl: repoUrl ?? "",
    exists: false,
    isFork: false,
    ownerMatchesCandidate: false,
    commitCount: 0,
    candidateCommitCount: 0,
    firstCommitAt: null,
    lastCommitAt: null,
    activeDays: 0,
    largestCommitShare: 0,
    linesOfCode: 0,
    languages: {},
    hasTests: false,
    install: skippedStep(),
    build: skippedStep(),
    test: skippedStep(),
    claimChecks: [],
    flags: [],
    authenticityScore: 0,
  });
}

async function listCommits(repo: GhRepo): Promise<CommitListItem[]> {
  const commits: CommitListItem[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const response = await github<CommitListItem[]>(
      `/repos/${repo.owner}/${repo.repo}/commits?per_page=100&page=${page}`,
    );
    if (response.status === 404) return commits;
    if (response.status === 409) return commits;
    if (response.status !== 200 || !Array.isArray(response.data)) break;
    commits.push(...response.data);
    if (response.data.length < 100) break;
  }
  return commits;
}

async function largestShare(repo: GhRepo, commits: CommitListItem[]): Promise<number> {
  const sample = commits.length <= 30 ? commits : [...commits.slice(0, 15), ...commits.slice(-15)];
  if (sample.length === 0) return 0;
  const additions: number[] = [];
  await mapPool(sample, 5, async (commit) => {
    const detail = await github<CommitDetail>(`/repos/${repo.owner}/${repo.repo}/commits/${commit.sha}`);
    additions.push(detail.data?.stats?.additions ?? 0);
  });
  const total = additions.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  return Math.max(...additions) / total;
}

async function languageMap(repo: GhRepo): Promise<Record<string, number>> {
  const response = await github<Record<string, number>>(`/repos/${repo.owner}/${repo.repo}/languages`);
  if (response.status !== 200 || !response.data || Array.isArray(response.data)) return {};
  return response.data;
}

async function readCorpus(repo: GhRepo, branch: string): Promise<{ text: string; hasTests: boolean; lines: number }> {
  const tree = await github<TreeResponse>(`/repos/${repo.owner}/${repo.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const nodes = tree.status === 200 && Array.isArray(tree.data?.tree) ? tree.data.tree : [];
  const hasTests = nodes.some((node) => /(^|\/)(__tests__|tests?|spec)(\/|$)|\.(test|spec)\./i.test(node.path ?? ""));
  const source = nodes
    .filter((node) => node.type === "blob" && /\.(ts|tsx|js|jsx|py|go|rs|java|kt|rb|php)$/i.test(node.path ?? ""))
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
    .slice(0, 12);

  const readme = await github<ReadmeResponse>(`/repos/${repo.owner}/${repo.repo}/readme`);
  const parts: string[] = [];
  if (readme.status === 200 && readme.data?.content && readme.data.encoding === "base64") {
    parts.push(Buffer.from(readme.data.content, "base64").toString("utf8").slice(0, 8000));
  }
  parts.push(nodes.map((node) => node.path).filter(Boolean).join("\n"));

  let lines = 0;
  for (const file of source) {
    if (!file.path) continue;
    const fileResponse = await github<{ content?: string; encoding?: string }>(
      `/repos/${repo.owner}/${repo.repo}/contents/${file.path.split("/").map(encodeURIComponent).join("/")}`,
    );
    if (fileResponse.status !== 200 || fileResponse.data?.encoding !== "base64" || !fileResponse.data.content) continue;
    const text = Buffer.from(fileResponse.data.content, "base64").toString("utf8");
    lines += text.split("\n").length;
    parts.push(`\n# ${file.path}\n${text.slice(0, 4000)}`);
  }

  return { text: parts.join("\n"), hasTests, lines };
}

export async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await fn(items[current] as T);
    }
  });
  await Promise.all(workers);
}

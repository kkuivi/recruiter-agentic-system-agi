import type { GithubProfile, GithubRepoSummary, ProjectClaim } from "@proofhire/contracts";
import { github, GithubError } from "./github.ts";

interface GhUser {
  login?: string;
  name?: string | null;
  bio?: string | null;
  public_repos?: number;
  followers?: number;
  html_url?: string;
}

interface GhUserRepo {
  name?: string;
  html_url?: string;
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
  fork?: boolean;
  pushed_at?: string | null;
}

export async function fetchGithubProfile(username: string): Promise<GithubProfile | null> {
  const login = username.trim();
  if (!login) return null;
  const user = await github<GhUser>(`/users/${encodeURIComponent(login)}`);
  if (user.status === 404) return null;
  if (user.status !== 200 || !user.data?.login) {
    throw new GithubError(`GitHub profile lookup failed (${user.status}).`, user.status);
  }
  const repos = await github<GhUserRepo[]>(
    `/users/${encodeURIComponent(user.data.login)}/repos?per_page=100&sort=updated&type=owner`,
  );
  const list = Array.isArray(repos.data) ? repos.data : [];
  return {
    username: user.data.login,
    htmlUrl: user.data.html_url || `https://github.com/${user.data.login}`,
    name: user.data.name ?? null,
    bio: user.data.bio ?? null,
    publicRepos: user.data.public_repos ?? list.length,
    followers: user.data.followers ?? 0,
    repos: list.slice(0, 30).map(toSummary).filter((repo): repo is GithubRepoSummary => Boolean(repo)),
  };
}

export function matchProjectRepo(project: ProjectClaim, profile: GithubProfile | null): string | null {
  if (project.repoUrl) return project.repoUrl;
  if (!profile) return null;
  const name = normalize(project.name);
  if (name.length < 3) return null;
  let best: { url: string; score: number } | null = null;
  for (const repo of profile.repos) {
    const repoName = normalize(repo.name);
    let score = 0;
    if (repoName && repoName === name) score = 100;
    else if (repoName && (name.includes(repoName) || repoName.includes(name))) score = 70;
    else if (repo.description && normalize(repo.description).includes(name)) score = 55;
    if (score > 0 && (!best || score > best.score)) best = { url: repo.url, score };
  }
  return best && best.score >= 55 ? best.url : null;
}

function toSummary(repo: GhUserRepo): GithubRepoSummary | null {
  if (!repo.name || !repo.html_url) return null;
  return {
    name: repo.name,
    url: repo.html_url,
    description: repo.description ?? null,
    language: repo.language ?? null,
    stars: repo.stargazers_count ?? 0,
    fork: Boolean(repo.fork),
    pushedAt: repo.pushed_at ?? null,
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

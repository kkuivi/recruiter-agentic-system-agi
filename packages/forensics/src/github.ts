export interface GhRepo {
  owner: string;
  repo: string;
}

export function parseGithubRepo(repoUrl: string): GhRepo | null {
  const cleaned = repoUrl.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const ssh = cleaned.match(/git@github\.com:([^/]+)\/(.+)$/);
  if (ssh?.[1] && ssh[2]) return { owner: ssh[1], repo: ssh[2] };
  try {
    const url = new URL(cleaned);
    if (!url.hostname.endsWith("github.com")) return null;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function github<T>(path: string): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "proofhire",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  const text = await response.text();
  let data = null as T;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as T;
    }
  }
  if (response.status === 403 || response.status === 429) {
    throw new GithubError(`GitHub rate limit or forbidden (${response.status}). Set GITHUB_TOKEN.`, response.status);
  }
  return { status: response.status, data };
}

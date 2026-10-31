const RESERVED = new Set([
  "about",
  "account",
  "apps",
  "collections",
  "customer-stories",
  "enterprise",
  "explore",
  "features",
  "gist",
  "gists",
  "issues",
  "join",
  "login",
  "marketplace",
  "new",
  "notifications",
  "orgs",
  "organizations",
  "pricing",
  "pull",
  "readme",
  "search",
  "security",
  "sessions",
  "settings",
  "site",
  "sponsors",
  "team",
  "topics",
  "users",
]);

export function extractGithubUsername(text: string): string | null {
  for (const match of text.matchAll(/github\.com\/([A-Za-z0-9-]+)/gi)) {
    const login = match[1];
    if (login && !RESERVED.has(login.toLowerCase())) return login;
  }
  const labeled = text.match(/github\s*(?:username|handle|profile|account)?\s*[:\-@]\s*@?([A-Za-z0-9-]+)/i);
  if (labeled?.[1] && !RESERVED.has(labeled[1].toLowerCase())) return labeled[1];
  return null;
}

export function githubRepoUrls(text: string): { owner: string; repo: string; url: string }[] {
  const found: { owner: string; repo: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/gi)) {
    const owner = match[1];
    const repo = match[2]?.replace(/\.git$/i, "").replace(/[).,]+$/g, "");
    if (!owner || !repo || RESERVED.has(owner.toLowerCase())) continue;
    const url = `https://github.com/${owner}/${repo}`;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ owner, repo, url });
  }
  return found;
}

import type { GithubProfile, ProjectClaim, RepoReport } from "@proofhire/contracts";

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.LLM_API_KEY);
}

export async function completeJson(model: string, system: string, user: string): Promise<unknown> {
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error("LLM_API_KEY is not set");
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`LLM request failed (${response.status})`);
  const body = (await response.json()) as ChatResponse;
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned an empty message");
  return JSON.parse(content);
}

export async function extractGithubLogin(resumeText: string): Promise<string | null> {
  const fast = process.env.LLM_MODEL_FAST || "gpt-4o-mini";
  const parsed = (await completeJson(
    fast,
    "Find the candidate's GitHub login in this resume. Return JSON {\"githubUsername\": string | null}. Use a login that is written in the resume. Do not guess a login from their name.",
    resumeText,
  )) as { githubUsername?: string | null };
  const login = typeof parsed.githubUsername === "string" ? parsed.githubUsername.trim().replace(/^@/, "") : "";
  return login || null;
}

export async function extractProjects(resumeText: string): Promise<ProjectClaim[]> {
  const fast = process.env.LLM_MODEL_FAST || "gpt-4o-mini";
  const parsed = (await completeJson(
    fast,
    "Extract projects from a resume. Return JSON {\"projects\": ProjectClaim[]}. Each project needs name, description, claimedTech, claimedFeatures, repoUrl, claimedDates. claimedFeatures must be concrete and checkable, for example \"consumes Kafka topics\". repoUrl is null when no URL is present. Do not invent repositories.",
    resumeText,
  )) as { projects?: ProjectClaim[] };
  return Array.isArray(parsed.projects) ? parsed.projects : [];
}

export async function scoreRelevance(
  jobDescription: string,
  projects: ProjectClaim[],
  reports: RepoReport[],
  profile: GithubProfile | null,
): Promise<{ relevance: number; summary: string }> {
  const smart = process.env.LLM_MODEL_SMART || process.env.LLM_MODEL_FAST || "gpt-4o";
  const parsed = (await completeJson(
    smart,
    "Score how relevant this candidate is to the job, from 0 to 100. Count only what the repo evidence supports. An unsupported claim adds nothing. A GitHub profile with no matching project code does not raise the score. Return JSON {\"relevance\": number, \"summary\": string}. The summary is two sentences and must say whether the GitHub account and the named projects were found.",
    JSON.stringify({
      jobDescription,
      projects,
      reports,
      github: profile
        ? { username: profile.username, bio: profile.bio, publicRepos: profile.publicRepos, repos: profile.repos.slice(0, 12) }
        : null,
    }),
  )) as { relevance?: number; summary?: string };
  const relevance = Math.max(0, Math.min(100, Math.round(Number(parsed.relevance ?? 0))));
  return { relevance, summary: String(parsed.summary ?? "") };
}

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { PanelEvent, PanelReport, ReviewerPersona } from "@proofhire/contracts";
import { loadSeed } from "./seed.ts";
import { extractGithubUsername } from "@proofhire/contracts";
import { rankJob, screenCandidate, screenJob, startPanel } from "./screen.ts";
import {
  addCandidate,
  addEvent,
  candidate,
  caseFile,
  currentJob,
  eventsOf,
  listCandidates,
  panelOf,
  profileOf,
  projectsOf,
  removeCandidate,
  reportsOf,
  savePanel,
  scoreOf,
  setStatus,
  updateCandidate,
  updateJob,
} from "./store.ts";
import { mirrorEvent, mirrorPanel, mirrorStatus } from "./supabase.ts";

loadSeed();

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true, service: "orchestrator" }));

app.get("/jobs/current", (c) => {
  const job = currentJob();
  return c.json({
    job,
    candidates: listCandidates().map((row) => ({
      id: row.id,
      name: row.name,
      githubUsername: row.githubUsername,
      resumeText: row.resumeText,
      status: row.status,
    })),
  });
});

app.patch("/jobs/:id", async (c) => {
  const job = currentJob();
  if (c.req.param("id") !== job.id) return c.json({ error: "job not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const expectations = body.personaExpectations;
  if (expectations && !validExpectations(expectations)) return c.json({ error: "persona expectations are incomplete" }, 400);
  return c.json({
    job: updateJob({
      title: typeof body.title === "string" ? body.title : job.title,
      description: typeof body.description === "string" ? body.description : job.description,
      personaExpectations: expectations,
      interviewerRoles: validRoles(body.interviewerRoles) ? body.interviewerRoles : job.interviewerRoles,
    }),
  });
});

app.post("/jobs/:id/candidates", async (c) => {
  if (c.req.param("id") !== currentJob().id) return c.json({ error: "job not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const resumeText = typeof body.resumeText === "string" ? body.resumeText : "";
  if (!name || !resumeText.trim()) return c.json({ error: "Name and resume are required." }, 400);
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : undefined;
  const row = addCandidate({
    id,
    name,
    resumeText,
    githubUsername: extractGithubUsername(resumeText) || "",
  });
  return c.json({ candidate: row }, 201);
});

app.patch("/candidates/:id", async (c) => {
  const row = candidate(c.req.param("id"));
  if (!row) return c.json({ error: "candidate not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : row.name;
  const resumeText = typeof body.resumeText === "string" ? body.resumeText : row.resumeText;
  if (!name || !resumeText.trim()) return c.json({ error: "Name and resume are required." }, 400);
  const updated = updateCandidate(row.id, {
    name,
    resumeText,
    githubUsername: extractGithubUsername(resumeText) || (resumeText === row.resumeText ? row.githubUsername : ""),
  });
  return c.json({ candidate: updated });
});

app.delete("/candidates/:id", (c) => {
  if (!candidate(c.req.param("id"))) return c.json({ error: "candidate not found" }, 404);
  removeCandidate(c.req.param("id"));
  return c.json({ ok: true });
});

app.post("/candidates/:id/screen", async (c) => {
  const row = candidate(c.req.param("id"));
  if (!row) return c.json({ error: "candidate not found" }, 404);
  try {
    await screenCandidate(row.id);
    rankJob(currentJob().id);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "screening failed" }, 502);
  }
  return c.json(board());
});

app.post("/jobs", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const job = currentJob();
  if (body && (body.title || body.description || body.personaExpectations)) {
    if (body.personaExpectations && !validExpectations(body.personaExpectations)) {
      return c.json({ error: "persona expectations are incomplete" }, 400);
    }
    updateJob({
      title: body.title ?? job.title,
      description: body.description ?? job.description,
      personaExpectations: body.personaExpectations,
    });
  }
  return c.json({ job: currentJob(), candidates: listCandidates() });
});

app.post("/jobs/:id/screen", async (c) => {
  const job = currentJob();
  if (c.req.param("id") !== job.id) return c.json({ error: "job not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const startPanels = Boolean(body?.startPanels ?? process.env.START_PANELS_ON_SCREEN === "true");
  await screenJob(job.id, startPanels);
  return c.json({ board: board() });
});

app.get("/jobs/:id/board", (c) => {
  if (c.req.param("id") !== currentJob().id) return c.json({ error: "job not found" }, 404);
  return c.json(board());
});

app.get("/candidates/:id", (c) => {
  const row = candidate(c.req.param("id"));
  if (!row) return c.json({ error: "candidate not found" }, 404);
  return c.json({
    candidate: row,
    job: currentJob(),
    projects: projectsOf(row.id),
    reports: reportsOf(row.id),
    score: scoreOf(row.id) ?? null,
    panel: panelOf(row.id) ?? null,
    profile: profileOf(row.id),
  });
});

app.get("/candidates/:id/events", (c) => {
  if (!candidate(c.req.param("id"))) return c.json({ error: "candidate not found" }, 404);
  return c.json({ events: eventsOf(c.req.param("id")) });
});

app.post("/candidates/:id/panel", async (c) => {
  const row = candidate(c.req.param("id"));
  if (!row) return c.json({ error: "candidate not found" }, 404);
  try {
    await startPanel(row.id);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "panel failed to start" }, 503);
  }
  await mirrorStatus(row.id, "panel_running");
  return c.json({ ok: true, candidateId: row.id, caseFile: caseFile(row.id) }, 202);
});

app.post("/internal/candidates/:id/events", async (c) => {
  const row = candidate(c.req.param("id"));
  if (!row) return c.json({ error: "candidate not found" }, 404);
  const body = (await c.req.json()) as { event?: PanelEvent };
  if (!body.event || typeof body.event.seq !== "number") return c.json({ error: "event is required" }, 400);
  addEvent(row.id, body.event);
  await mirrorEvent(row.id, body.event);
  return c.json({ ok: true });
});

app.post("/internal/candidates/:id/fail", (c) => {
  const row = candidate(c.req.param("id"));
  if (!row) return c.json({ error: "candidate not found" }, 404);
  if (row.status === "panel_running") setStatus(row.id, "screened");
  return c.json({ ok: true });
});

app.post("/internal/candidates/:id/complete", async (c) => {
  const row = candidate(c.req.param("id"));
  if (!row) return c.json({ error: "candidate not found" }, 404);
  const body = (await c.req.json()) as { report?: PanelReport };
  if (!body.report) return c.json({ error: "report is required" }, 400);
  savePanel(body.report);
  await mirrorPanel(body.report);
  return c.json({ ok: true });
});

app.get("/candidates/:id/case", (c) => {
  const file = caseFile(c.req.param("id"));
  if (!file) return c.json({ error: "case file not ready" }, 404);
  return c.json(file);
});

function board() {
  const job = currentJob();
  const candidates = listCandidates()
    .map((row) => {
      const score = scoreOf(row.id);
      const panel = panelOf(row.id);
      const reports = reportsOf(row.id);
      const flags = [...new Set(reports.flatMap((report) => report.flags))];
      return {
        id: row.id,
        name: row.name,
        githubUsername: row.githubUsername,
        status: row.status,
        rank: score?.rank ?? null,
        fit: score?.fit ?? null,
        relevance: score?.relevance ?? null,
        authenticity: score?.authenticity ?? null,
        summary: score?.summary ?? null,
        flags,
        projectsNamed: projectsOf(row.id).length,
        reposFound: reports.filter((report) => report.exists).length,
        recommendation: panel?.recommendation ?? null,
        panelScore: panel?.panelScore ?? null,
      };
    })
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return { job, candidates };
}

function validExpectations(value: Partial<Record<ReviewerPersona, string>>): boolean {
  return ["project_manager", "staff_engineer", "associate_engineer"].every((key) => typeof value[key as ReviewerPersona] === "string");
}

function validRoles(value: unknown): value is Partial<Record<ReviewerPersona, string>> {
  if (!value || typeof value !== "object") return false;
  return ["project_manager", "staff_engineer", "associate_engineer"].every((key) => {
    const role = (value as Record<string, unknown>)[key];
    return role === undefined || typeof role === "string";
  });
}

const port = Number(process.env.ORCH_PORT || 4000);
Bun.serve({ port, fetch: app.fetch });
console.log(`orchestrator on http://127.0.0.1:${port}`);

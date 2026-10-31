import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CandidateInput, CandidateStatus, JobSpec, PanelReport, ProjectClaim, RepoReport } from "@proofhire/contracts";
import { aggregateFit } from "@proofhire/forensics/score";
import { emptyCollections, initStore, seedVersion, type StoredCandidate } from "./store.ts";

const root = path.resolve(process.cwd(), "seed");

interface ScreenFixture {
  candidateId: string;
  relevance: number;
  summary: string;
  projects: ProjectClaim[];
  reports: RepoReport[];
}

export function loadSeed(): void {
  const job = JSON.parse(readFileSync(path.join(root, "job.json"), "utf8")) as JobSpec;
  const candidateFiles = readdirSync(path.join(root, "candidates")).filter((file) => file.endsWith(".json"));
  const fixtures = new Map<string, ScreenFixture>();
  for (const file of readdirSync(path.join(root, "fixtures/screens"))) {
    if (!file.endsWith(".json")) continue;
    const fixture = JSON.parse(readFileSync(path.join(root, "fixtures/screens", file), "utf8")) as ScreenFixture;
    fixtures.set(fixture.candidateId, fixture);
  }
  const panels = new Map<string, PanelReport>();
  const panelDir = path.join(root, "fixtures/panel-reports");
  for (const file of readdirSync(panelDir).filter((name) => name.endsWith(".json"))) {
    const report = JSON.parse(readFileSync(path.join(panelDir, file), "utf8")) as PanelReport;
    panels.set(report.candidateId, report);
  }

  const candidates: StoredCandidate[] = candidateFiles.map((file) => {
    const input = JSON.parse(readFileSync(path.join(root, "candidates", file), "utf8")) as CandidateInput;
    const status: CandidateStatus = panels.has(input.id) ? "panel_done" : "screened";
    return { ...input, jobId: job.id, status };
  });

  const collections = emptyCollections();
  const scored: { id: string; fit: number }[] = [];
  const reportDir = path.join(root, "fixtures/repo-reports");
  mkdirSync(reportDir, { recursive: true });
  for (const row of candidates) {
    const fixture = fixtures.get(row.id);
    if (!fixture) continue;
    const agg = aggregateFit(fixture.relevance, fixture.reports);
    collections.projects[row.id] = fixture.projects;
    collections.reports[row.id] = agg.reports;
    collections.scores[row.id] = {
      candidateId: row.id,
      relevance: fixture.relevance,
      authenticity: agg.authenticity,
      fit: agg.fit,
      rank: 0,
      summary: fixture.summary,
    };
    scored.push({ id: row.id, fit: agg.fit });
    writeFileSync(path.join(reportDir, `${row.id}.json`), JSON.stringify(agg.reports, null, 2));
    const panel = panels.get(row.id);
    if (panel) collections.panels[row.id] = panel;
  }
  scored.sort((a, b) => b.fit - a.fit);
  scored.forEach((item, index) => {
    const score = collections.scores[item.id];
    if (score) score.rank = index + 1;
  });

  initStore({
    seedVersion,
    job,
    candidates,
    ...collections,
  });
}

import { aggregateFit } from "@proofhire/forensics/score";
import type { CandidateInput, JobSpec, PanelReport, ProjectClaim, RepoReport } from "@proofhire/contracts";
import jobJson from "../../../seed/job.json";
import maya from "../../../seed/candidates/maya-chen.json";
import jordan from "../../../seed/candidates/jordan-hale.json";
import alex from "../../../seed/candidates/alex-rivera.json";
import samir from "../../../seed/candidates/samir-okonkwo.json";
import ellis from "../../../seed/candidates/ellis-ward.json";
import mayaScreen from "../../../seed/fixtures/screens/maya-chen.json";
import jordanScreen from "../../../seed/fixtures/screens/jordan-hale.json";
import alexScreen from "../../../seed/fixtures/screens/alex-rivera.json";
import samirScreen from "../../../seed/fixtures/screens/samir-okonkwo.json";
import ellisScreen from "../../../seed/fixtures/screens/ellis-ward.json";
import mayaPanel from "../../../seed/fixtures/panel-reports/maya-chen.json";
import jordanPanel from "../../../seed/fixtures/panel-reports/jordan-hale.json";

interface Fixture {
  candidateId: string;
  relevance: number;
  summary: string;
  projects: ProjectClaim[];
  reports: RepoReport[];
}

const people = [maya, jordan, alex, samir, ellis] as CandidateInput[];
const fixtures = [mayaScreen, jordanScreen, alexScreen, samirScreen, ellisScreen] as Fixture[];
const panels = new Map<string, PanelReport>([
  [mayaPanel.candidateId, mayaPanel as PanelReport],
  [jordanPanel.candidateId, jordanPanel as PanelReport],
]);

const job = jobJson as JobSpec;

const scored = people
  .map((person) => {
    const fixture = fixtures.find((item) => item.candidateId === person.id);
    if (!fixture) throw new Error(`missing fixture for ${person.name}`);
    const agg = aggregateFit(fixture.relevance, fixture.reports);
    return {
      person,
      projects: fixture.projects,
      reports: agg.reports,
      relevance: fixture.relevance,
      authenticity: agg.authenticity,
      fit: agg.fit,
      summary: fixture.summary,
      panel: panels.get(person.id) ?? null,
    };
  })
  .sort((a, b) => b.fit - a.fit)
  .map((row, index) => ({ ...row, rank: index + 1 }));

export function offlineCurrent() {
  return {
    job,
    candidates: scored.map((row) => ({
      ...row.person,
      status: row.panel ? "panel_done" : "screened",
    })),
  };
}

export function offlineBoard() {
  return {
    job,
    candidates: scored.map((row) => ({
      id: row.person.id,
      name: row.person.name,
      githubUsername: row.person.githubUsername,
      status: row.panel ? "panel_done" : "screened",
      rank: row.rank,
      fit: row.fit,
      relevance: row.relevance,
      authenticity: row.authenticity,
      summary: row.summary,
      flags: [...new Set(row.reports.flatMap((report) => report.flags))],
      recommendation: row.panel?.recommendation ?? null,
      panelScore: row.panel?.panelScore ?? null,
    })),
  };
}

export function offlineCandidate(id: string) {
  const row = scored.find((item) => item.person.id === id);
  if (!row) return null;
  return {
    candidate: { ...row.person, jobId: job.id, status: row.panel ? "panel_done" : "screened" },
    job,
    projects: row.projects,
    reports: row.reports,
    score: {
      candidateId: row.person.id,
      relevance: row.relevance,
      authenticity: row.authenticity,
      fit: row.fit,
      rank: row.rank,
      summary: row.summary,
    },
    panel: row.panel,
  };
}

import type { RepoReport, StepResult } from "@proofhire/contracts";

export function skippedStep(): StepResult {
  return { attempted: false, ok: false, logTail: "" };
}

export function scoreRepo(
  report: Pick<
    RepoReport,
    | "exists"
    | "isFork"
    | "ownerMatchesCandidate"
    | "commitCount"
    | "candidateCommitCount"
    | "activeDays"
    | "largestCommitShare"
    | "install"
    | "build"
    | "claimChecks"
  >,
): { flags: string[]; authenticityScore: number } {
  if (!report.exists) return { flags: ["repo_missing"], authenticityScore: 0 };

  let score = 100;
  const flags: string[] = [];
  const penalize = (amount: number, flag?: string) => {
    score -= amount;
    if (flag) flags.push(flag);
  };

  if (report.isFork && report.candidateCommitCount === 0) penalize(50, "fork_no_work");
  if (!report.ownerMatchesCandidate && report.candidateCommitCount === 0) penalize(30, "not_owner");
  if (report.commitCount <= 3) penalize(25, "few_commits");
  if (report.largestCommitShare > 0.8) penalize(20, "single_dump");
  if (report.activeDays <= 1) penalize(15, "one_day");
  if (report.build.attempted && !report.build.ok) penalize(15, "build_fails");
  if (report.install.attempted && !report.install.ok) penalize(10, "install_fails");

  for (const check of report.claimChecks) {
    if (check.verdict === "unsupported") penalize(10, "claim_unsupported");
    else if (check.verdict === "partial") penalize(4);
  }

  return { flags, authenticityScore: Math.max(0, Math.min(100, score)) };
}

export function normalizeReport(report: RepoReport): RepoReport {
  const scored = scoreRepo(report);
  return { ...report, ...scored };
}

export function aggregateFit(
  relevance: number,
  reports: RepoReport[],
): { authenticity: number; fit: number; reports: RepoReport[] } {
  const normalized = reports.map(normalizeReport);
  let authenticity = 0;
  if (normalized.length) {
    const loc = normalized.reduce((sum, report) => sum + Math.max(0, report.linesOfCode), 0);
    authenticity =
      loc === 0
        ? Math.round(normalized.reduce((sum, report) => sum + report.authenticityScore, 0) / normalized.length)
        : Math.round(
            normalized.reduce((sum, report) => sum + report.authenticityScore * report.linesOfCode, 0) / loc,
          );
  }
  let fit = Math.round(0.5 * relevance + 0.5 * authenticity);
  if (normalized.some((report) => report.flags.includes("repo_missing"))) fit = Math.min(fit, 40);
  return {
    authenticity: clamp(authenticity),
    fit: clamp(fit),
    reports: normalized,
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

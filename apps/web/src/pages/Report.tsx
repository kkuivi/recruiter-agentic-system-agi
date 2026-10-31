import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { GithubProfile, PanelReport, ProjectClaim, RepoReport } from "@proofhire/contracts";
import { loadCandidate, type CandidateDetail } from "../api";
import { useDemo } from "../App";
import { FlagChip, Score, VerdictChip, formatWhen, percent, tone, verdictLabel } from "../ui";

export function Report() {
  const { id = "" } = useParams();
  const { demo } = useDemo();
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      loadCandidate(id, demo)
        .then((next) => {
          if (!cancelled) setDetail(mergeStored(next));
        })
        .catch((reason: Error) => {
          if (!cancelled) setError(reason.message || "This candidate could not be loaded.");
        });
    };
    pull();
    const timer = window.setInterval(pull, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, demo]);

  if (!detail) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-16">
        <p className="text-muted">{error || "Loading the evidence…"}</p>
      </main>
    );
  }

  const { candidate, score, panel, projects, reports, profile } = detail;
  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <Link to={`/jobs/${detail.job.id}`} className="text-sm font-semibold text-accent">
        Back to the shortlist
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Rank {score?.rank ?? "—"} · {candidate.githubUsername ? `@${candidate.githubUsername}` : "No GitHub account on the resume"}
          </p>
          <h1 className="mt-2 font-serif text-5xl">{candidate.name}</h1>
          <p className="mt-3 max-w-2xl text-lg text-muted">{score?.summary}</p>
        </div>
        <div className="flex gap-6">
          <Score value={score?.fit ?? null} label="Fit" />
          <Score value={score?.relevance ?? null} label="Relevance" />
          <Score value={score?.authenticity ?? null} label="Authenticity" />
        </div>
      </div>

      {panel ? <PanelBlock panel={panel} /> : (
        <section className="mt-8 rounded-3xl border border-dashed border-line bg-card px-5 py-4 text-muted">
          The panel has not filed a report yet. The evidence below is what they will argue from.
          {(candidate.status === "screened" || candidate.status === "panel_running") && (score?.rank ?? 99) <= 3 ? (
            <Link to={`/candidates/${candidate.id}/room`} className="ml-2 font-semibold text-accent">
              Open the room
            </Link>
          ) : null}
        </section>
      )}

      <ProfileBlock profile={profile} screened={Boolean(score)} />

      <div className="mt-10 grid gap-6">
        {projects.length === 0 && score ? (
          <p className="rounded-3xl border border-dashed border-line bg-card px-5 py-4 text-muted">No projects were named on this resume.</p>
        ) : null}
        {projects.map((project) => (
          <ProjectBlock key={project.name} project={project} report={reports.find((item) => item.repoUrl === project.repoUrl)} />
        ))}
      </div>
    </main>
  );
}

function mergeStored(detail: CandidateDetail): CandidateDetail {
  if (detail.panel) return detail;
  const raw = sessionStorage.getItem(`proofhire-report:${detail.candidate.id}`);
  if (!raw) return detail;
  try {
    const panel = JSON.parse(raw) as PanelReport;
    if (panel.candidateId !== detail.candidate.id) return detail;
    return { ...detail, panel };
  } catch {
    return detail;
  }
}

function PanelBlock({ panel }: { panel: PanelReport }) {
  return (
    <section className="mt-8 rounded-3xl border border-line bg-card p-6">
      <div className="flex flex-wrap items-center gap-4">
        <VerdictChip verdict={panel.recommendation} />
        <div>
          <div className={`font-serif text-5xl tabular-nums ${tone(panel.panelScore)}`}>{panel.panelScore}</div>
          <div className="text-xs uppercase tracking-[0.14em] text-muted">Panel score · {verdictLabel(panel.recommendation)}</div>
        </div>
      </div>
      <p className="mt-4 max-w-3xl text-lg">{panel.summary}</p>
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <List title="Consensus" items={panel.consensus} />
        <List title="Disagreements" items={panel.disagreements} />
        <List title="Questions for HR" items={panel.questionsForHR} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {panel.reviews.map((review) => (
          <article key={review.persona} className="rounded-2xl bg-paper p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{review.persona.replaceAll("_", " ")}</h3>
              <VerdictChip verdict={review.verdict} />
            </div>
            <p className="mt-2 text-sm">{review.headline}</p>
            <div className={`mt-3 font-serif text-3xl tabular-nums ${tone(review.score)}`}>{review.score}</div>
            <FindingList title="Red flags" findings={review.redFlags} danger />
          </article>
        ))}
      </div>
    </section>
  );
}

function ProfileBlock({ profile, screened }: { profile?: GithubProfile | null; screened: boolean }) {
  if (!profile) {
    if (!screened) return null;
    return (
      <section className="mt-8 rounded-3xl border border-dashed border-line bg-card px-5 py-4 text-muted">
        No GitHub profile could be read from this resume.
      </section>
    );
  }
  return (
    <section className="mt-8 rounded-3xl border border-line bg-card p-6">
      <h2 className="font-serif text-3xl">GitHub profile</h2>
      <a className="mt-2 inline-block font-semibold text-accent" href={profile.htmlUrl} target="_blank" rel="noreferrer">
        @{profile.username}
      </a>
      {profile.bio ? <p className="mt-2 max-w-3xl text-muted">{profile.bio}</p> : null}
      <p className="mt-2 text-sm text-muted">
        {profile.publicRepos} public repos · {profile.followers} followers
      </p>
      <ul className="mt-4 grid gap-2">
        {profile.repos.slice(0, 8).map((repo) => (
          <li key={repo.url} className="flex flex-wrap items-baseline justify-between gap-2 rounded-2xl bg-paper px-4 py-3">
            <a href={repo.url} target="_blank" rel="noreferrer" className="font-semibold">
              {repo.name}
            </a>
            <span className="text-sm text-muted">
              {repo.language ?? "Unknown language"} · {repo.stars} stars{repo.fork ? " · fork" : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProjectBlock({ project, report }: { project: ProjectClaim; report?: RepoReport }) {
  return (
    <section className="rounded-3xl border border-line bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-3xl">{project.name}</h2>
          <p className="mt-1 max-w-3xl text-muted">{project.description}</p>
          <p className="mt-2 text-sm">{project.repoUrl ?? "No repository listed"}</p>
        </div>
        <div className={`font-serif text-4xl tabular-nums ${tone(report?.authenticityScore ?? 0)}`}>{report?.authenticityScore ?? 0}</div>
      </div>
      {report ? (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line md:grid-cols-4">
            <Stat label="Claimed dates" value={project.claimedDates ?? "—"} />
            <Stat label="First commit" value={formatWhen(report.firstCommitAt)} />
            <Stat label="Last commit" value={formatWhen(report.lastCommitAt)} />
            <Stat label="Commits" value={String(report.commitCount)} bad={report.commitCount <= 3 && report.exists} />
            <Stat label="Their commits" value={String(report.candidateCommitCount)} bad={report.exists && report.candidateCommitCount === 0} />
            <Stat label="Largest commit" value={percent(report.largestCommitShare)} bad={report.largestCommitShare > 0.8} />
            <Stat label="Active days" value={String(report.activeDays)} bad={report.exists && report.activeDays <= 1} />
            <Stat label="Build" value={stepLabel(report.build)} bad={report.build.attempted && !report.build.ok} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {[...new Set(report.flags)].map((flag) => (
              <FlagChip key={`${report.repoUrl}-${flag}`} flag={flag} />
            ))}
          </div>
          {report.build.attempted && !report.build.ok ? (
            <pre className="mt-4 overflow-auto rounded-2xl bg-ink px-4 py-3 text-sm text-paper">{report.build.logTail}</pre>
          ) : null}
          <ul className="mt-4 grid gap-2">
            {report.claimChecks.map((check) => (
              <li key={check.claim} className="rounded-2xl bg-paper px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs font-semibold uppercase tracking-wide ${check.verdict === "supported" ? "text-good" : check.verdict === "partial" ? "text-warn" : "text-bad"}`}>
                    {check.verdict}
                  </span>
                  <span className="font-semibold">{check.claim}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{check.evidence}</p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-4 text-muted">No forensic report for this project.</p>
      )}
    </section>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`mt-1 font-semibold ${bad ? "text-bad" : ""}`}>{value}</dd>
    </div>
  );
}

function stepLabel(step: { attempted: boolean; ok: boolean }): string {
  if (!step.attempted) return "Not run";
  return step.ok ? "Passed" : "Failed";
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{title}</h3>
      <ul className="mt-2 grid gap-2 text-sm">
        {items.length === 0 ? <li className="text-muted">None recorded.</li> : items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function FindingList({ title, findings, danger }: { title: string; findings: { text: string; evidence: string }[]; danger?: boolean }) {
  if (findings.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-xs uppercase tracking-wide text-muted">{title}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {findings.map((finding) => (
          <span key={finding.text} title={finding.evidence} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${danger ? "bg-bad-bg text-bad" : "bg-card"}`}>
            {finding.text}
          </span>
        ))}
      </div>
    </div>
  );
}

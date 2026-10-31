import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { loadBoard, runPanel, type Board } from "../api";
import { useDemo } from "../App";
import { FlagChip, Score, StatusChip, VerdictChip } from "../ui";

export function Ranked() {
  const { id = "" } = useParams();
  const { demo } = useDemo();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      loadBoard(id, demo)
        .then((next) => {
          if (!cancelled) {
            setBoard(next);
            setError("");
          }
        })
        .catch((reason: Error) => {
          if (!cancelled) setError(reason.message || "The shortlist could not be loaded.");
        });
    };
    pull();
    const timer = window.setInterval(pull, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, demo]);

  async function onRun(candidateId: string) {
    if (demo) {
      navigate(`/candidates/${candidateId}/room`);
      return;
    }
    setPending(candidateId);
    setError("");
    try {
      await runPanel(candidateId);
      navigate(`/candidates/${candidateId}/room`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The panel did not start.");
      setPending("");
    }
  }

  if (!board) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-16">
        <p className="text-muted">{error || "Loading the shortlist…"}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{board.job.title}</p>
      <h1 className="mt-2 font-serif text-5xl">Shortlist</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted">
        Fit is half relevance, half authenticity. Relevance only counts claims the repository supports. The top three can go to the panel.
      </p>
      {error ? <p className="mt-4 text-sm text-bad">{error}</p> : null}
      <div className="mt-8 divide-y divide-line rounded-3xl border border-line bg-card">
        {board.candidates.map((person) => (
          <article key={person.id} className="grid gap-4 px-5 py-5 lg:grid-cols-[3rem_minmax(0,1fr)_auto] lg:items-center">
            <div className="font-serif text-3xl text-muted">{person.rank ?? "—"}</div>
            <div className="min-w-0">
              <Link to={`/candidates/${person.id}`} className="text-xl font-semibold hover:text-accent">
                {person.name}
              </Link>
              <div className="text-sm text-muted">{person.githubUsername ? `@${person.githubUsername}` : "No GitHub account on the resume"}</div>
              {typeof person.projectsNamed === "number" ? (
                <p className="mt-1 text-sm text-muted">
                  {person.reposFound ?? 0} of {person.projectsNamed} named projects found on GitHub
                </p>
              ) : null}
              <p className="mt-1 max-w-xl text-sm leading-snug">{person.summary}</p>
              <div className="mt-3 flex flex-wrap gap-6">
                <Score compact value={person.fit} label="Fit" />
                <Score compact value={person.relevance} label="Relevance" />
                <Score compact value={person.authenticity} label="Authenticity" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {person.flags.map((flag) => (
                  <FlagChip key={flag} flag={flag} />
                ))}
                {person.recommendation ? <VerdictChip verdict={person.recommendation} /> : null}
              </div>
            </div>
            <div className="flex min-w-[8rem] flex-col items-start gap-2 lg:pt-1">
                <StatusChip status={person.status} />
                {person.status === "panel_running" ? (
                  <Link to={`/candidates/${person.id}/room`} className="text-sm font-semibold text-accent">
                    Open the room
                  </Link>
                ) : person.recommendation ? (
                  <Link to={`/candidates/${person.id}`} className="text-sm font-semibold text-accent">
                    View report
                  </Link>
                ) : (person.rank ?? 99) <= 3 ? (
                  <button
                    type="button"
                    disabled={pending === person.id}
                    onClick={() => void onRun(person.id)}
                    className="rounded-full bg-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {pending === person.id ? "Starting…" : "Run panel"}
                  </button>
                ) : (
                  <span className="text-xs text-muted">Below the panel line</span>
                )}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

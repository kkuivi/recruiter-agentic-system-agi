import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { extractGithubUsername, REVIEWERS, type JobSpec, type ReviewerPersona } from "@proofhire/contracts";
import {
  createCandidate,
  deleteCandidate,
  loadCurrent,
  saveJob,
  screenCandidate,
  updateCandidate,
  type RosterCandidate,
} from "../api";
import { useDemo } from "../App";
import { textFromResumePdf } from "../resumePdf";

const DEFAULT_ROLE: Record<ReviewerPersona, string> = {
  project_manager: "Project manager",
  staff_engineer: "Staff engineer",
  associate_engineer: "Associate engineer",
};

interface Draft {
  id: string;
  name: string;
  resumeText: string;
  resumeFileName: string;
  readingResume: boolean;
  resumeError: string;
}

export function JobSetup() {
  const { demo } = useDemo();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobSpec | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [knownIds, setKnownIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCurrent(demo)
      .then((payload) => {
        if (cancelled) return;
        setJob(withRoles(payload.job));
        setDrafts(payload.candidates.map(toDraft));
        setKnownIds(payload.candidates.map((person) => person.id));
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message || "The orchestrator is not running.");
      });
    return () => {
      cancelled = true;
    };
  }, [demo]);

  function patchRole(persona: ReviewerPersona, role: string) {
    if (!job) return;
    setJob({ ...job, interviewerRoles: { ...job.interviewerRoles, [persona]: role } });
  }

  function patchExpectation(persona: ReviewerPersona, expectations: string) {
    if (!job) return;
    setJob({ ...job, personaExpectations: { ...job.personaExpectations, [persona]: expectations } });
  }

  function patchDraft(id: string, patch: Partial<Draft>) {
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  async function onAttachPdf(id: string, file: File | undefined) {
    if (!file) return;
    patchDraft(id, { readingResume: true, resumeError: "" });
    try {
      const resumeText = await textFromResumePdf(file);
      patchDraft(id, { resumeText, resumeFileName: file.name, readingResume: false, resumeError: "" });
    } catch (reason) {
      patchDraft(id, {
        readingResume: false,
        resumeError: reason instanceof Error ? reason.message : "Could not read that PDF.",
      });
    }
  }

  async function onScreen() {
    if (!job) return;
    if (demo) {
      setError("Turn demo mode off. Demo mode replays a recorded panel and does not read these resumes.");
      return;
    }
    const ready = drafts.filter((draft) => draft.name.trim() && draft.resumeText.trim());
    if (!job.description.trim()) {
      setError("Add a job description before screening.");
      return;
    }
    if (ready.length === 0) {
      setError("Add at least one candidate with a name and a resume.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveJob(job);
      const readyIds = new Set(ready.map((draft) => draft.id));
      for (const id of knownIds) {
        if (!readyIds.has(id)) await deleteCandidate(id);
      }
      for (const draft of ready) {
        const body = { id: draft.id, name: draft.name.trim(), resumeText: draft.resumeText };
        if (knownIds.includes(draft.id)) await updateCandidate(draft.id, body);
        else await createCandidate(job.id, body);
      }
      for (let index = 0; index < ready.length; index += 1) {
        const draft = ready[index];
        if (!draft) continue;
        setProgress(`Screening ${draft.name.trim()} (${index + 1} of ${ready.length}). Reading the resume and checking GitHub.`);
        await screenCandidate(draft.id);
      }
      navigate(`/jobs/${job.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Screening failed.");
      setProgress("");
      setBusy(false);
    }
  }

  if (!job) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <p className="text-muted">{error || "Loading the role…"}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Hiring screen</p>
      <h1 className="mt-3 font-serif text-5xl leading-[1.05] text-ink">Set up the screen</h1>
      <p className="mt-4 text-lg text-muted">
        Add the role, who is interviewing, and every resume. Screening finds the GitHub account on each resume and checks the projects that resume names.
      </p>

      <section className="mt-10">
        <h2 className="font-serif text-3xl">Role</h2>
        <label className="mt-4 block text-sm font-semibold">
          Job title
          <input className="mt-2" value={job.title} onChange={(event) => setJob({ ...job, title: event.target.value })} />
        </label>
        <label className="mt-4 block text-sm font-semibold">
          Job description
          <textarea
            className="mt-2 min-h-36"
            value={job.description}
            onChange={(event) => setJob({ ...job, description: event.target.value })}
            placeholder="What this person will build, and which skills the work actually needs."
          />
        </label>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-3xl">Interviewers</h2>
        <p className="mt-2 text-sm text-muted">Three seats. Each one gets a job function and a note about what they need to see in the candidate.</p>
        <div className="mt-4 grid gap-4">
          {REVIEWERS.map((persona, index) => (
            <article key={persona} className="rounded-3xl border border-line bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Interviewer {index + 1}</p>
              <label className="mt-3 block text-sm font-semibold">
                Job function
                <input
                  className="mt-2"
                  value={job.interviewerRoles?.[persona] ?? DEFAULT_ROLE[persona]}
                  onChange={(event) => patchRole(persona, event.target.value)}
                  placeholder={DEFAULT_ROLE[persona]}
                />
              </label>
              <label className="mt-4 block text-sm font-semibold">
                Expectations for the candidate
                <textarea
                  className="mt-2 min-h-28"
                  value={job.personaExpectations[persona]}
                  onChange={(event) => patchExpectation(persona, event.target.value)}
                  placeholder="What this interviewer needs the profile to show."
                />
              </label>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-3xl">Candidates</h2>
            <p className="mt-2 text-sm text-muted">Add as many as you need. Attach a resume PDF or paste the text. The GitHub account is read from that text.</p>
          </div>
          <button
            type="button"
            onClick={() =>
              setDrafts((current) => [...current, { id: crypto.randomUUID(), name: "", resumeText: "", resumeFileName: "", readingResume: false, resumeError: "" }])
            }
            className="shrink-0 rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold"
          >
            Add candidate
          </button>
        </div>
        <div className="mt-4 grid gap-4">
          {drafts.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-line bg-card px-5 py-6 text-muted">No candidates yet.</p>
          ) : null}
          {drafts.map((draft, index) => {
            const login = extractGithubUsername(draft.resumeText);
            return (
              <article key={draft.id} className="rounded-3xl border border-line bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Candidate {index + 1}</p>
                  <button type="button" onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))} className="text-sm font-semibold text-bad">
                    Remove
                  </button>
                </div>
                <label className="mt-3 block text-sm font-semibold">
                  Name
                  <input className="mt-2" value={draft.name} onChange={(event) => patchDraft(draft.id, { name: event.target.value })} placeholder="Candidate name" />
                </label>
                <div className="mt-4">
                  <p className="text-sm font-semibold">Resume</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label
                      htmlFor={`resume-pdf-${draft.id}`}
                      className={`rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold ${draft.readingResume ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
                    >
                      {draft.readingResume ? "Reading PDF…" : draft.resumeFileName ? "Replace PDF" : "Attach PDF"}
                    </label>
                    <input
                      id={`resume-pdf-${draft.id}`}
                      type="file"
                      accept="application/pdf,.pdf"
                      className="sr-only"
                      disabled={draft.readingResume}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        void onAttachPdf(draft.id, file);
                      }}
                    />
                    {draft.resumeFileName ? <span className="text-sm text-muted">{draft.resumeFileName}</span> : <span className="text-sm text-muted">or paste the text below</span>}
                  </div>
                  <textarea
                    className="mt-3 min-h-40"
                    value={draft.resumeText}
                    onChange={(event) => patchDraft(draft.id, { resumeText: event.target.value })}
                    placeholder="Paste the resume, including the GitHub profile and the projects they claim."
                  />
                </div>
                {draft.resumeError ? <p className="mt-2 text-sm text-bad">{draft.resumeError}</p> : null}
                <p className="mt-2 text-sm text-muted">{login ? `GitHub account found: @${login}` : "No GitHub account in this resume yet."}</p>
              </article>
            );
          })}
        </div>
      </section>

      {error ? <p className="mt-6 text-sm text-bad">{error}</p> : null}
      {progress ? <p className="mt-4 text-sm text-accent">{progress}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void onScreen()}
        className="mt-6 rounded-full bg-accent px-5 py-3 font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Screening…" : "Run screening"}
      </button>
    </main>
  );
}

function withRoles(job: JobSpec): JobSpec {
  return {
    ...job,
    interviewerRoles: {
      project_manager: job.interviewerRoles?.project_manager || DEFAULT_ROLE.project_manager,
      staff_engineer: job.interviewerRoles?.staff_engineer || DEFAULT_ROLE.staff_engineer,
      associate_engineer: job.interviewerRoles?.associate_engineer || DEFAULT_ROLE.associate_engineer,
    },
  };
}

function toDraft(person: RosterCandidate): Draft {
  return { id: person.id, name: person.name, resumeText: person.resumeText, resumeFileName: "", readingResume: false, resumeError: "" };
}

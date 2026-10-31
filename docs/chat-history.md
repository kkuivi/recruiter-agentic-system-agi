# ProofHire chat history

October 31, 2026. Three Cursor sessions on this repo. This file keeps the requests and the answers that changed the product. Tool logs, system prompts, and `.env` values are left out.

The uploaded plan is [ProofHire_Technical_Implementation_Plan.pdf](./ProofHire_Technical_Implementation_Plan.pdf). The working conclusions are in [context.md](./context.md).

## 1. Walkthrough, then build

**1:46 PM.** The plan PDF was attached, with this request: walk through the process of building it, so the understanding can be checked before any code is written.

The walkthrough that was accepted:

ProofHire checks resume claims against the GitHub repo, then runs the top candidates through a live three-persona panel. The repo was empty. Screening and forensics are precomputed. Only one panel debate runs live.

Six parts, one shared contract:

1. **Web** (`apps/web`). Job setup, ranked list, final report, and a panel room that exists mainly for the demo.
2. **Orchestrator** (`apps/orchestrator`). Extracts projects from resume text, calls forensics, scores and ranks, writes to Supabase, and starts panels for the top three.
3. **Forensics** (`packages/forensics`). Turns a repo URL and resume claims into a `RepoReport`. Untrusted code only runs inside a Superserve sandbox.
4. **Panel actor** (`apps/actor`). One Terse Durable Actor per candidate. Stores the case file, accepts each persona's work, advances the phases, and broadcasts events. Never calls an LLM or any slow network request.
5. **Panel service** (`services/panel`). Python FastAPI. Persona agents talk through an Agent Relay channel and report results back to the actor.
6. **Supabase.** Jobs, candidates, repo reports, scores, panel reports, and the event log. Realtime on that log is the room's fallback if the Terse socket fails.

Live path: the web app asks the orchestrator to start a panel, the orchestrator loads the case file into the actor and tells the Python service to run, the agents debate and submit each round to the actor, and the room watches the broadcast. After the moderator finishes, the report is copied into Supabase.

Build order:

- Contracts first. Everything else codes against the same types and fixture JSON.
- Setup: monorepo, root `.env` (never committed), Supabase schema with row-level security off, shared types, Python models mirrored as Pydantic.
- Five go/no-go spikes, in order, with the documented fallback if one fails: deploy a Terse counter and call it, call that actor from Python, exchange a message between two Agent Relay agents, clone a public repo in a Superserve sandbox and run `git log`, scaffold Mastra with one structured agent call and one workflow. Official docs win wherever they disagree with the plan.
- Parallel tracks, each runnable alone against `seed/fixtures`: forensics, screening, actor, panel service, web.
- Integration: real forensics feed screening, screening starts panels for the top three, the room shows a real panel, then cache all five, record one real panel into the replay file, and rehearse the two-minute script including once in Demo mode.

Demo script: job setup, ranked list and candidate C's evidence, Run panel into the live room, then the final report. Candidate C's resume looks excellent and the repo is a thin scaffold, so authenticity drops and the panel rejects.

Fallbacks if a spike fails: local `terse actor dev`, a TypeScript bridge for Python, logging channel posts onto the actor, GitHub-only git signals, or calling the model SDK directly.

**1:51 PM.** "build it."

The stack was built with those fallbacks in place, because sponsor credentials were not set yet. Measured seed scores matched the plan (Maya 96 advance, Jordan 81 maybe, Alex 24 with the thin-repo flags, Samir 7 untouched fork, Ellis 3 missing repos). A live deterministic panel on Alex rejected with score 27 (project manager reject 17, staff reject 17, associate maybe 46). State was then reset so Alex starts screened and Run panel is available. Maya and Jordan stay `panel_done` from seed reports.

## 2. Credentials

**2:19 PM.** Where does `LLM_API_KEY` come from?

It is an OpenAI API key, sent to `https://api.openai.com/v1`. `gpt-4o-mini` covers screening and the first two panel rounds. `gpt-4o` is the moderator. Create it at platform.openai.com/api-keys. A ChatGPT Plus subscription does not include it. The seeded demo does not need it. With the key empty, screening stays on cached repo reports and the panel judges from the case file.

**2:21 PM.** Step by step for `TERSE_ACTOR_URL`, `RELAY_API_KEY`, `SUPERSERVE_API_KEY`, and `GITHUB_TOKEN`.

None of these are required for the seeded demo.

- **GitHub.** Fine-grained personal access token, public repositories, Contents read-only. Used by `bun run forensics`. Raises the public rate limit from 60 requests an hour to 5,000.
- **Superserve.** Create a key at console.superserve.ai. Prefix `ss_live_`. The forensics path still reads GitHub only. Filling the key in does not turn a sandbox build on.
- **Agent Relay.** No separate user API key. `agent-relay workspace create proofhire` prints `rk_live_…` once. Put it in `RELAY_API_KEY`. Leave `RELAY_BASE_URL` empty to use the hosted engine. There is no command that prints the key again. `workspace list` and `status` show the name only. If the key was missed, create the workspace again.
- **Terse.** `terse deploy` from an actor project prints a URL like `https://api.useterse.ai/<project-id>/actors`. That string is `TERSE_ACTOR_URL`. Docs: docs.useterse.ai/quickstart.

**2:26 PM.** What is the command to see the Agent Relay key?

`agent-relay workspace create proofhire`. It prints the key once. Nothing prints it later.

**2:31–2:35 PM.** Step-by-step Terse deploy, then a terminal error from that attempt.

Login reached the browser and failed on the last step: creating an API key returned 429. Nothing was stored, so `terse deploy` still says you are not authenticated. Create the key in the Terse dashboard instead of asking the CLI to mint another one, and put it in `actor/.env` as `TERSE_API_KEY`. The project that would have deployed at that moment was still the scaffolded Counter, not the ProofHire panel. That was fixed later the same day (section 4).

**2:52 PM.** What is needed from Supabase?

Optional mirror. The app already runs from `data/db.json`. The orchestrator writes to Supabase only when both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.

1. Create a project.
2. Run `supabase/schema.sql` in the SQL editor. That creates `jobs`, `candidates`, `repo_reports`, `candidate_scores`, `panel_reports`, and `panel_events`, and adds the panel tables to the realtime publication. Leave row-level security off.
3. Copy the project URL and the `service_role` secret into `.env`.

`SUPABASE_ANON_KEY` is unused. The HR app reads the orchestrator, not Supabase. No Auth, Storage, or extra policies. Screening scores stay in the local file. `panel_events` references `candidates`, so those rows only insert after a matching candidate row exists.

**2:55 PM.** Blocked on Terse deploy. Deploy the rest and test. What is needed?

Nothing else has a host. The actor on port 8787 is the referee. Restart after filling keys, because the processes read `.env` at startup. `USE_FIXTURES` stays true for the demo. Tests that were available: `bun run check`, `bun run smoke`, one public repo through `bun run forensics`, and Alex's Run panel with Demo mode off.

**2:59 PM.** Are the Supabase values in `.env` yet?

Yes, locally: project URL, anon key, and service role key. The orchestrator only uses the URL and the service role key, and only after a restart, and only after the SQL has been run. Those values were never committed.

## 3. Intake form

**3:04 PM.** The UI needs to change:

1. Add candidate profiles with a resume and a name. Multiple candidates.
2. Job description.
3. Input an interviewer job function, then expectations for the interviewee.
4. Run screen.
5. While screening, get the GitHub profile from the resume and analyze that profile and the projects named in the resume.
6. Show the analysis.

The setup page at http://127.0.0.1:5173/ became that form. Role (title and description), three interviewer seats (job function and what they need to see), and as many candidates as you want (name and pasted resume). As you paste, the form looks for a GitHub account and shows it, for example `GitHub account found: @octocat`.

Run screening, per resume: read the GitHub login, load the public profile and repositories, pull out named projects and match them (including `github.com/owner/repo` links), check those repositories, and score against the job description.

The shortlist shows the GitHub account, how many named projects were found, and fit, relevance, and authenticity. Open a name for the profile and the per-project evidence. The five seeded resumes are still loaded. Unchanged seed text reuses the cached demo analysis. A resume you add or edit is checked live, so the paste has to include the GitHub profile or a repository link. Turn Demo mode off before screening someone you pasted. Demo mode only replays the recorded panel.

**3:26 PM** (separate session). For the candidate section, allow attaching a resume PDF.

Each candidate can attach a PDF as well as pasted text. Attach PDF reads the file and fills the resume field. The filename stays next to the button, and the text can still be edited. GitHub detection uses that text the same way as a paste. A file that is not a PDF, is over 8 MB, or is a scan with no selectable text is rejected.

## 4. Terse actor code

**3:13 PM.** Look at the `actor` folder and the Terse quickstart (https://docs.useterse.ai/quickstart) and write the actor code that is needed.

The folder was still the Counter scaffold. It was replaced with a `PanelRoom` actor: a class in `actor/src/actor.ts`, `@Persisted` fields, one alarm, and websocket broadcast. One room per candidate. The actor id is the candidate id. It stores the case file and referees the rounds. It does not call a model.

| Method | What it does |
|---|---|
| `start` | Stores the case file and opens the independent round |
| `submitReview` | Saves one review. The third review opens cross-exam |
| `submitCrossExam` | Saves one set of notes. The third set opens synthesis |
| `postMessage` | Appends a line for the room |
| `submitReport` | Files the report and marks the panel done |
| `getState` | Returns the phase, case file, reviews, and the last 200 events |
| `onAlarm` | After 90 seconds, marks whoever has not submitted as timed out and advances the round |

A client that connects, or sends `{ "type": "subscribe" }`, receives the event log so far. Each new event is broadcast as `{ "type": "event", event }`. Submitting the same persona twice overwrites the earlier submission.

The running app still uses the local referee on port 8787. This Terse class is what you deploy from the `actor` folder.

**3:17 PM.** `terse actor dev` failed. The runtime treats every method on the class as an actor call, and each call has to be `async`. A synchronous helper named `arm` was refused.

Those helpers were made private, so they are no longer actor calls.

**3:19 PM.** `terse actor dev` works. It serves `PanelRoom` at http://127.0.0.1:7100. From the `actor` folder, in another terminal: `terse actor generate`.

**3:20 PM.** How do we deploy this project?

The only deploy command in the repo is the Terse actor. The HR app, the orchestrator, and the Python panel have no host. They stay on this machine with `bun run dev`.

Deploy, from `actor/`, with `terse actor dev` still allowed to keep running:

1. `terse auth status`. If it says you are not authenticated, do not run `terse auth login` again right away. The last attempts died on a rate limit while creating a key. Open app.useterse.ai, create a token under API keys, and put `TERSE_API_KEY` in `actor/.env`.
2. `terse deploy`.
3. The URL the CLI prints is `TERSE_ACTOR_URL`. Keep that URL and the token out of the recruiter app's root `.env` for now. The hosted Terse URL speaks the generated client's API. The running app still posts to `/actors/<id>/start` on http://127.0.0.1:8787.

**3:23 PM.** Create a test case from a Senior Android Engineer posting (Applied Foundations: account, payments, safety, Kotlin, production quality).

The setup job in the running app was set to that role. No candidate was added. Equal-opportunity, background-check, compensation, and benefits text was left out of the stored description so it would not affect the score.

| Seat | Job function | What they need to see |
|---|---|---|
| 1 | Engineering manager, Applied Foundations | A production Android surface they actually owned. Resume dates and the repository should describe the same work. Features listed with no matching code do not count. |
| 2 | Staff Android engineer | Production Kotlin or Java in the repo: UI, networking, local state, and tests. Claims about payments, security, or performance have to show up in the code, not only in a README. |
| 3 | Android product engineer, identity and payments | Readable Kotlin another engineer could extend, careful state and error handling, and enough substance to take a ticket on account, family, or payments. A sample app or an untouched fork is not enough. |

That job was stored in the local database. It is not in `seed/job.json`. A fresh clone still loads the original Senior Full-Stack Engineer seed.

## 5. GitHub

**3:39 PM.** Create a repo and put the project on GitHub.

Published as https://github.com/kkuivi/recruiter-agentic-system-agi. `main` tracks `origin/main`. The first commit has the app source, seed fixtures, and lockfiles. `.env`, `data/`, `node_modules`, and `.agentworkforce` stayed out.

**3:40 PM.** Make it public.

The repository is public. The ignored files were never committed.

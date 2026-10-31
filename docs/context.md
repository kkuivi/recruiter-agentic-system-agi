# ProofHire context

Date: October 31, 2026.
Repo: https://github.com/kkuivi/recruiter-agentic-system-agi (public).
Plan: [ProofHire_Technical_Implementation_Plan.pdf](./ProofHire_Technical_Implementation_Plan.pdf).

ProofHire is a hiring screen. HR enters a job and candidates. The system checks resume project claims against GitHub, scores each person, and can run the top candidates through a three-persona panel (project manager, staff engineer, associate engineer) plus a moderator. A panel room shows that debate live. The room exists mainly for the demo.

The plan assumed a two-hour build and a two-minute live demo. The conversation after the build changed the product from a fixed five-person demo into an intake form that can screen resumes you paste or attach.

## What the plan required

- Five seeded candidates, one job. The top three go to the panel. Only one debate (candidate C) runs live. Screening and forensics are precomputed for the demo.
- Resume input is plain text. No login, no row-level security, no live human interview.
- Shared contracts first. Python mirrors them as Pydantic models.
- The Terse actor never calls a model or any slow network. It is a stateful referee: one call at a time, idempotent writes, a 90-second alarm.
- Official docs win where they disagree with the plan. If a sponsor spike fails, take that section's fallback and do not keep debugging it.
- Sponsor tools: Terse Durable Actors, Agent Relay, Mastra, Superserve, Supabase.

Scoring, from the plan and the check script:

- Authenticity starts at 100. Penalties: `fork_no_work` 50, `not_owner` 30, `few_commits` 25, `single_dump` 20, `one_day` 15, `build_fails` 15, `install_fails` 10, unsupported claim 10, partial claim 4. Clamp 0–100.
- Fit = round(0.5 × relevance + 0.5 × authenticity). Authenticity is weighted by lines of code across repos.
- A missing repo caps fit at 40. Relevance only counts claims the repo supports.

Expected demo rank:

| | Person | Outcome |
|---|---|---|
| A | Maya Chen | Genuine strong. Advance. Fit 96, relevance 92, authenticity 100. |
| B | Jordan Hale | Genuine moderate. Maybe. Fit 81, relevance 66, authenticity 96. |
| C | Alex Rivera | Inflated resume, thin repo. Rank 3. Panel rejects. Fit 24, relevance 42, authenticity 5. Flags: `few_commits`, `single_dump`, `one_day`, `build_fails`, `claim_unsupported`. |
| D | Samir Okonkwo | Untouched fork. Fit 7, authenticity 0. Flags: `fork_no_work`, `not_owner`. |
| E | Ellis Ward | Three 404 repos. Fit 3, authenticity 0. Flag: `repo_missing`. Never paneled. |

Fixed ids: job `11111111-1111-4111-8111-111111111111`. Maya `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1`, Jordan `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2`, Alex `cccccccc-cccc-4ccc-8ccc-ccccccccccc3`, Samir `dddddddd-dddd-4ddd-8ddd-ddddddddddd4`, Ellis `eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5`.

Seed candidates A and B were supposed to be real teammate repos. None were provided, so the seed uses fictional people and fixture repo reports.

## What is in the repo

Monorepo on Bun workspaces (`apps/*`, `packages/*`). Python 3.11 for the panel service.

| Path | Role |
|---|---|
| `apps/web` | Vite 6, React 19, React Router 7, Tailwind v4. Job setup, shortlist, evidence report, panel room. |
| `apps/orchestrator` | Hono on port 4000. Screening, ranking, file store at `data/db.json` (gitignored). |
| `apps/actor` | Local `PanelRoom` referee on port 8787. This is what the running app calls. |
| `actor/` | Terse SDK actor (`PanelRoom` in `actor/src/actor.ts`). Used by `terse actor dev` on port 7100. Not yet called by the orchestrator. |
| `packages/contracts` | Shared TypeScript types. |
| `packages/forensics` | GitHub REST analysis and authenticity/fit scoring. |
| `services/panel` | FastAPI on port 8000. Persona reviews, cross-exam, moderator report. |
| `seed/` | Job, five candidates, screen fixtures, two finished panel reports, Alex replay log. |
| `supabase/schema.sql` | Tables and realtime publication. Row-level security off. |
| `scripts/dev.sh` | Starts actor, orchestrator, panel, and the web app. |
| `.env.example` | Variable names. Copy to `.env`. Never commit `.env`. |

`proofhire/` at the repo root is the original Terse quickstart scaffold (a Counter). The panel actor that `terse actor dev` loads is `actor/`, not that folder.

The web app proxies `/api` to port 4000. The panel-room websocket is direct: `VITE_ACTOR_WS=ws://127.0.0.1:8787`.

## Decisions that override the plan

These were accepted during the build. Do not "fix" them back to the PDF unless you are intentionally switching a fallback on.

- **Mastra is not wired.** Screening is plain TypeScript steps (`extractProjects`, `analyzeProjects`, `scoreRelevance`, `computeScore`, `persist`) plus a direct OpenAI-compatible `completeJson`. That is the plan's Mastra fallback.
- **Terse cloud is not the live referee.** `apps/actor` is the local fallback. The Terse class in `actor/` is ready for `terse actor dev` and, once login works, `terse deploy`. Pasting a hosted Terse URL into the root `TERSE_ACTOR_URL` would send the orchestrator's `/actors/:id/start` calls to the wrong API. Keep the app on `ACTOR_URL=http://127.0.0.1:8787` until a generated Terse client is wired in.
- **Superserve is not called.** Forensics uses the GitHub API only. Install, build, and test inside a sandbox are skipped. `SUPERSERVE_API_KEY` does nothing until that call is written.
- **Agent Relay is best-effort.** The panel always `postMessage`s and submits to the actor. It posts to Relay only if `RELAY_API_KEY` is set and `agent_relay` imports. `agent-relay-sdk` was not installed in `services/panel/.venv`.
- **Supabase is an optional mirror.** The app reads the orchestrator, not Supabase. Events, the finished report, and candidate status are copied there only when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set and `supabase/schema.sql` has been run. The anon key is unused. Screening scores stay in `data/db.json`.
- **Panels do not start during screening.** `START_PANELS_ON_SCREEN=false`, so the demo can press Run panel. `startPanels: true` on the screen request is the plan's integration path.
- **Demo mode** (`localStorage` key `proofhire-demo`) replays `seed/fixtures/panel-replay.json` (about 16 seconds, panel score 22, reject) and does not call a model. The live deterministic panel on Alex, with no LLM key, scored 27 and rejected, with the associate saying maybe. Those are different numbers on purpose.
- **UI copy does not call the local socket Terse.** The room says the debate is live from the panel actor, a recorded replay, or the event log.

`USE_FIXTURES=true` keeps the five seeded resumes on cached reports. A resume you add or edit is checked live against GitHub. Turn Demo mode off before screening someone you typed in. Demo mode only replays the recorded panel.

## Product changes after the first build

The first build matched the seeded demo. Later the same day the setup page became an intake form:

1. Add several candidates, each with a name and a resume.
2. Edit the job title and description.
3. Three interviewer seats. Each has a job function and what that person needs to see.
4. Run screening.
5. Screening reads a GitHub account from the resume, loads the public profile and repos, matches projects named in the resume (including `github.com/owner/repo` links), and scores them against the job.
6. The shortlist shows the GitHub account, how many named projects were found, and fit, relevance, and authenticity. The report page shows profile and per-project evidence.

Each candidate can also attach a resume PDF. The file is read in the browser and its text fills the resume field. Screening still uses that text. A non-PDF, a file over 8 MB, or a scan with no selectable text is rejected. The code is `apps/web/src/resumePdf.ts`.

A test case was applied in the running app for a Senior Android Engineer role on an Applied Foundations team (account, payments, safety, Kotlin). The legal, compensation, and benefits text was left out of the stored description. That change was written into the local database (`data/`, gitignored). It is **not** in `seed/job.json`. A fresh clone still loads **Senior Full-Stack Engineer** for a realtime data platform, with the original three persona expectations.

## How to run

```bash
cp .env.example .env
bun install
bun run dev
```

`scripts/dev.sh` creates `services/panel/.venv` with `python3.11` if needed, then starts the actor (8787), orchestrator (4000), panel (8000), and Vite (http://127.0.0.1:5173). Do not use `bun --cwd`. This Bun version treats that flag as usage text and exits.

Checks that do not need keys:

```bash
bun run check   # score order and flags
bun run smoke   # actor phases, idempotent review, alarm
```

Live forensics, when you want a real repo instead of a fixture:

```bash
bun run forensics <repoUrl> <githubUsername>
```

Terse actor, from `actor/`, separate from `bun run dev`:

```bash
cd actor
terse actor dev      # Ready at http://127.0.0.1:7100
terse actor generate # typed client, in another terminal
```

`terse deploy` was blocked. `terse auth login` reached the browser and then failed creating an API key with HTTP 429. Create the token in the Terse dashboard (API keys) and put it in `actor/.env` as `TERSE_API_KEY` before trying deploy again. Do not hammer `terse auth login`.

## Credentials

Names only. Values live in the local `.env`, which is gitignored and was never pushed.

| Variable | Where it comes from | What uses it |
|---|---|---|
| `LLM_API_KEY` | OpenAI platform API key (`sk-…`). ChatGPT Plus does not include this. | `gpt-4o-mini` for screening and the first two panel rounds. `gpt-4o` for the moderator. Empty key: fixtures and deterministic reviews. |
| `GITHUB_TOKEN` | Fine-grained PAT, public repos, Contents read-only. | `bun run forensics`. Raises the public rate limit. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Project URL and service role secret, after running `supabase/schema.sql`. | Orchestrator mirror of panel events, reports, and status. |
| `SUPABASE_ANON_KEY` | Dashboard. | Unused. |
| `SUPERSERVE_API_KEY` | console.superserve.ai. | Unused until a sandbox call is written. |
| `RELAY_API_KEY`, `RELAY_WORKSPACE` | `agent-relay workspace create proofhire` prints `rk_live_…` once. There is no command to print it again. | Panel posts only if the Python SDK imports. |
| `TERSE_API_KEY` | app.useterse.ai API keys, into `actor/.env`. | `terse deploy`. Not the recruiter app's root env. |

The local demo runs with empty keys.

## Known sharp edges

- Pydantic in the panel service does not take positional constructor args. Use `Finding(text=, evidence=)`. A helper named `fact()` exists for that. Do not write `Finding("a", "b")`.
- If `data/db.json` exists and its seed version matches, the orchestrator keeps it. A completed panel survives restart. Bump the seed version in `apps/orchestrator/src/store.ts` to force a reseed. Deleting `data/db.json` also reseeds, and that drops anything typed into the intake form.
- `terse actor dev` rejected a synchronous helper because every public method on the actor class must be `async`. Helpers on `PanelRoom` are private so they are not actor calls.
- Vite did not always hot-reload file writes during the build. Restart the web process if the setup page looks stale.
- The shortlist layout was fixed so scores no longer collide with the action column (`apps/web/src/pages/Ranked.tsx`).
- Actor alarm timers are unref'd, and `stop()` clears them. The smoke script calls `stop()` so the process can exit.

## Still open

- Wire the orchestrator to the generated Terse client, then deploy. Until then, port 8787 is the referee.
- Install `agent-relay-sdk` in the panel venv if Relay posts should actually leave the machine.
- Write the Superserve sandbox steps (clone, install, build, test). Failed steps are data, not errors.
- Mastra, if you want the sponsor workflow runtime instead of the plain TypeScript steps.
- Confirm a Supabase project has had `supabase/schema.sql` applied before expecting rows there. Keys in a local `.env` do nothing until the process is restarted after they are set.
- Put the Android role into `seed/job.json` if that test case should survive a fresh clone. Right now it only existed in the local database.
- Mobile layout was not checked.
- After a demo-mode replay, the room writes `sessionStorage` key `proofhire-report:<candidateId>`. The report page is supposed to merge that when the API has no panel yet. That last page check was not finished.

Demo path on a fresh clone: Setup, Run screening, shortlist, Alex's evidence, then either Run panel (live, Demo mode off) or Demo mode (recorded replay), then the HR report.

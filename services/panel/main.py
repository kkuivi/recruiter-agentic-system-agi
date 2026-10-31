import asyncio
import os
import traceback
from pathlib import Path

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

from agents import REVIEWERS, notes_for, relay_post, report_for, review_for
from clients import ActorClient, OrchestratorClient

PHASES = ["idle", "independent", "crossexam", "synthesis", "done"]


def load_env() -> None:
    path = Path(__file__).resolve().parents[2] / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()

app = FastAPI(title="ProofHire panel")
TASKS: set[asyncio.Task] = set()


class PanelIn(BaseModel):
    candidateId: str


def spawn(coro) -> None:
    task = asyncio.create_task(coro)
    TASKS.add(task)
    task.add_done_callback(TASKS.discard)


@app.get("/health")
async def health():
    return {"ok": True, "service": "panel"}


@app.get("/panels/{candidate_id}")
async def panel_state(candidate_id: str):
    async with httpx.AsyncClient(timeout=10) as http:
        actor = ActorClient(http, os.environ.get("ACTOR_URL", "http://127.0.0.1:8787"))
        state = await actor.state(candidate_id)
    return {"candidateId": candidate_id, "phase": state.get("phase")}


@app.post("/panels")
async def start_panel(body: PanelIn):
    spawn(run_panel(body.candidateId))
    return {"ok": True, "candidateId": body.candidateId}


async def run_panel(candidate_id: str) -> None:
    actor_url = os.environ.get("ACTOR_URL", "http://127.0.0.1:8787")
    orch_url = os.environ.get("ORCH_URL", "http://127.0.0.1:4000")
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            actor = ActorClient(http, actor_url)
            orch = OrchestratorClient(http, orch_url)
            await debate(candidate_id, actor, orch)
    except Exception:
        traceback.print_exc()
        try:
            async with httpx.AsyncClient(timeout=10) as http:
                await OrchestratorClient(http, orch_url).fail(candidate_id)
        except Exception:
            traceback.print_exc()


async def debate(candidate_id: str, actor: ActorClient, orch: OrchestratorClient) -> None:
    state = await actor.state(candidate_id)
    case = state.get("caseFile")
    if not case:
        case = await orch.case_file(candidate_id)
    short = candidate_id.replace("-", "")[:8]
    channel = f"cand-{short}"

    async def remember(result: dict) -> None:
        for event in result.get("events") or []:
            await orch.record_event(candidate_id, event)

    async def say(persona: str, text: str) -> None:
        await relay_post(f"{persona}-{short}", channel, text)
        result = await actor.call(candidate_id, "postMessage", {"persona": persona, "text": text})
        await remember(result)

    print(f"panel {candidate_id} round 1")
    reviews = await asyncio.gather(*[review_for(persona, case) for persona in REVIEWERS])
    for review in reviews:
        flag = review.redFlags[0].text if review.redFlags else review.headline
        await say(review.persona, f"{review.headline} {flag}")
        result = await actor.call(candidate_id, "submitReview", review.model_dump())
        await remember(result)

    state = await wait_phase(actor, candidate_id, "crossexam")
    note_sets: list = []
    if state.get("phase") == "crossexam":
        print(f"panel {candidate_id} round 2")
        note_sets = list(await asyncio.gather(*[notes_for(persona, case, list(reviews)) for persona in REVIEWERS]))
        for persona, notes in zip(REVIEWERS, note_sets):
            for note in notes:
                await say(persona, f"To {note.targetPersona.replace('_', ' ')}: {note.text}")
            result = await actor.call(
                candidate_id,
                "submitCrossExam",
                {"persona": persona, "notes": [note.model_dump() for note in notes]},
            )
            await remember(result)

    state = await wait_phase(actor, candidate_id, "synthesis")
    if state.get("phase") == "synthesis":
        print(f"panel {candidate_id} round 3")
        flat_notes = [note for notes in note_sets for note in notes]
        report = await report_for(case, list(reviews), flat_notes)
        await say("moderator", report.summary)
        result = await actor.call(candidate_id, "submitReport", report.model_dump())
        await remember(result)
        await orch.complete(candidate_id, report.model_dump())
        print(f"panel {candidate_id} {report.recommendation} {report.panelScore}")


async def wait_phase(actor: ActorClient, candidate_id: str, target: str) -> dict:
    target_index = PHASES.index(target)
    for _ in range(90):
        state = await actor.state(candidate_id)
        phase = state.get("phase", "idle")
        if phase in PHASES and PHASES.index(phase) >= target_index:
            return state
        await asyncio.sleep(0.4)
    raise TimeoutError(f"timed out waiting for {target}")

import os
from datetime import datetime, timezone

import httpx

from contracts import CrossExamNote, Finding, PanelReport, PersonaReview, Reviewer

REVIEWERS: list[Reviewer] = ["project_manager", "staff_engineer", "associate_engineer"]
RANK = {"reject": 0, "maybe": 1, "advance": 2}
LENS = {
    "project_manager": ("Project Manager", "ownership, scope delivered, impact, and whether the resume timeline matches the repository"),
    "staff_engineer": ("Staff Engineer", "architecture depth, whether the build runs, tests, and whether complexity matches the claims"),
    "associate_engineer": ("Associate Engineer", "fundamentals, readability, and whether they could contribute on the team quickly"),
}


def worst_report(case: dict) -> dict | None:
    reports = case.get("repoReports") or []
    if not reports:
        return None
    return min(reports, key=lambda report: report.get("authenticityScore", 0))


def flags_of(report: dict | None) -> set[str]:
    if not report:
        return set()
    return set(report.get("flags") or [])


def resume_line(case: dict) -> str:
    lines = [line.strip() for line in case.get("resumeText", "").splitlines() if line.strip()]
    for line in lines:
        if "http" in line or any(char.isdigit() for char in line):
            return line
    return lines[-1] if lines else "Resume text was empty."


def pct(value: float) -> str:
    return f"{round(float(value) * 100)}%"


def fact(text: str, evidence: str) -> Finding:
    return Finding(text=text, evidence=evidence)


def verdict_for(persona: Reviewer, report: dict | None, relevance: int) -> str:
    flags = flags_of(report)
    if report is None:
        return "reject"
    if persona == "project_manager":
        if flags & {"repo_missing", "fork_no_work", "few_commits", "single_dump"}:
            return "reject"
        return "maybe" if relevance < 75 else "advance"
    if persona == "staff_engineer":
        if flags & {"repo_missing", "fork_no_work", "build_fails", "claim_unsupported"}:
            return "reject"
        if not report.get("hasTests") or relevance < 80:
            return "maybe"
        return "advance"
    if "repo_missing" in flags or "fork_no_work" in flags:
        return "reject"
    if report.get("authenticityScore", 0) < 30 and report.get("exists") and report.get("ownerMatchesCandidate"):
        return "maybe"
    return "maybe" if relevance < 70 else "advance"


def score_for(verdict: str, fit: int) -> int:
    if verdict == "advance":
        return max(80, min(98, fit))
    if verdict == "maybe":
        return max(46, min(74, fit if fit < 80 else 68))
    return max(10, min(34, round(fit * 0.7) or 12))


def unsupported(report: dict | None) -> list[dict]:
    if not report:
        return []
    return [check for check in report.get("claimChecks") or [] if check.get("verdict") == "unsupported"]


def deterministic_review(persona: Reviewer, case: dict) -> PersonaReview:
    report = worst_report(case)
    score = case.get("score") or {}
    relevance = int(score.get("relevance") or 0)
    fit = int(score.get("fit") or 0)
    verdict = verdict_for(persona, report, relevance)
    flags = flags_of(report)
    name = case.get("candidateName", "The candidate")
    line = resume_line(case)
    checks = unsupported(report)
    claim_evidence = checks[0]["evidence"] if checks else "No unsupported claim was recorded."
    claim_text = checks[0]["claim"] if checks else "the headline project"

    if report is None or "repo_missing" in flags:
        headline = f"{name}'s headline repository is not on GitHub."
        strengths = [fact("No repository evidence was available to credit.", "GitHub returned 404.")]
        drawbacks = [fact("The projects cannot be checked.", line)]
        red = [fact("A missing repository scores as no work.", "Flag repo_missing.")]
    elif "fork_no_work" in flags:
        headline = f"{name} is pointing at a fork they have never committed to."
        strengths = [fact("The upstream project exists.", report.get("repoUrl", ""))]
        drawbacks = [fact("None of the commits belong to the candidate.", f"candidateCommitCount is {report.get('candidateCommitCount')}.")]
        red = [fact("Ownership was claimed for work the candidate did not author.", "Flags fork_no_work and not_owner.")]
    elif persona == "project_manager" and verdict == "reject":
        headline = f"The resume timeline and the git timeline are not the same project."
        strengths = [fact("The repository is in the candidate's account.", f"ownerMatchesCandidate is {report.get('ownerMatchesCandidate')}.")]
        drawbacks = [fact(
            f"The history is {report.get('commitCount')} commits across {report.get('activeDays')} active day.",
            f"Claimed dates: {line}",
        )]
        red = [fact(f"The largest commit holds {pct(report.get('largestCommitShare') or 0)} of the added lines.", "Flag single_dump.")]
    elif persona == "staff_engineer" and verdict == "reject":
        build = (report.get("build") or {}).get("logTail") or "Build was not healthy."
        headline = "The architecture in the resume is not in the source, and the build does not back it up."
        strengths = [fact("Anything the claim checker marked supported is real.", "See claimChecks with verdict supported.")]
        drawbacks = [fact("The repository is too thin for the seniority on the resume.", f"{report.get('linesOfCode')} lines, hasTests={report.get('hasTests')}.")]
        red = [fact(f"Unsupported: {claim_text}.", f"{claim_evidence} Build: {build}")]
    elif persona == "associate_engineer" and verdict == "maybe":
        headline = "The code that exists is small enough to read. It is not the system in the resume."
        strengths = [fact("There is a real file a teammate could open.", claim_evidence if "supported" in claim_evidence.lower() else "The repository exists and the candidate owns it.")]
        drawbacks = [fact("This would not teach a new hire how the team's pipeline works.", f"{report.get('commitCount')} commits, {report.get('linesOfCode')} lines.")]
        red = [fact("The resume should not keep claims the code does not support.", f"Unsupported: {claim_text}. {claim_evidence}")]
    elif verdict == "advance":
        headline = "The repository supports the resume on the points this seat cares about."
        strengths = [fact("History, ownership, and the supported claims line up.", f"{report.get('commitCount')} commits, {report.get('activeDays')} active days.")]
        drawbacks = [fact("A live interview should still ask what they would change.", line)]
        red = []
    else:
        headline = "The work is real, and it is only a partial match for this role."
        strengths = [fact("The candidate authored the repository.", f"{report.get('candidateCommitCount')} of {report.get('commitCount')} commits.")]
        drawbacks = [fact("Relevance to the job stops where the evidence stops.", f"Relevance {relevance}. Fit {fit}.")]
        red = []

    return PersonaReview(
        persona=persona,
        verdict=verdict,  # type: ignore[arg-type]
        score=score_for(verdict, fit),
        headline=headline,
        strengths=[fact(**item) if isinstance(item, dict) else item for item in strengths],
        drawbacks=[fact(**item) if isinstance(item, dict) else item for item in drawbacks],
        redFlags=[fact(**item) if isinstance(item, dict) else item for item in red],
    )


def deterministic_notes(persona: Reviewer, reviews: list[PersonaReview]) -> list[CrossExamNote]:
    mine = next(review for review in reviews if review.persona == persona)
    notes: list[CrossExamNote] = []
    for other in reviews:
        if other.persona == persona:
            continue
        if RANK[mine.verdict] < RANK[other.verdict]:
            notes.append(CrossExamNote(
                persona=persona,
                targetPersona=other.persona,
                type="challenge",
                text=f"I can't follow a {other.verdict}. {mine.headline}",
            ))
        elif mine.verdict == other.verdict:
            notes.append(CrossExamNote(
                persona=persona,
                targetPersona=other.persona,
                type="concede",
                text=f"Agreed. {other.headline}",
            ))
        else:
            notes.append(CrossExamNote(
                persona=persona,
                targetPersona=other.persona,
                type="add",
                text=f"I am softer than you, and I still want this on the record: {mine.headline}",
            ))
    return notes[:2]


def deterministic_report(case: dict, reviews: list[PersonaReview], notes: list[CrossExamNote]) -> PanelReport:
    counts = {"advance": 0, "maybe": 0, "reject": 0}
    for review in reviews:
        counts[review.verdict] += 1
    if counts["reject"] >= 2:
        recommendation = "reject"
    elif counts["advance"] >= 2 and counts["reject"] == 0:
        recommendation = "advance"
    else:
        recommendation = "maybe"
    mean = round(sum(review.score for review in reviews) / max(1, len(reviews)))
    panel_score = min(mean, 40) if recommendation == "reject" else mean
    verdicts = {review.persona: review.verdict for review in reviews}
    disagreements = []
    if len(set(verdicts.values())) > 1:
        disagreements.append(
            "The reviewers did not start on the same verdict: "
            + ", ".join(f"{persona.replace('_', ' ')} said {verdict}" for persona, verdict in verdicts.items())
            + "."
        )
    consensus = [review.headline for review in reviews if review.verdict == recommendation][:2]
    if not consensus:
        consensus = [reviews[0].headline]
    questions = questions_for(case)
    summary = (
        f"{case.get('candidateName')} — the panel says {recommendation}. "
        + " ".join(consensus[:1])
    )
    return PanelReport(
        candidateId=case["candidateId"],
        panelScore=max(0, min(100, panel_score)),
        recommendation=recommendation,  # type: ignore[arg-type]
        summary=summary,
        consensus=consensus,
        disagreements=disagreements,
        questionsForHR=questions,
        reviews=reviews,
        crossExam=notes,
        completedAt=datetime.now(timezone.utc).isoformat(),
    )


def questions_for(case: dict) -> list[str]:
    report = worst_report(case)
    flags = flags_of(report)
    questions = []
    if "repo_missing" in flags:
        questions.append("Ask for a repository that exists, or a screen-share of private work.")
    if "fork_no_work" in flags:
        questions.append("Ask which commits are theirs. The answer on this fork is none.")
    if "few_commits" in flags or "single_dump" in flags:
        questions.append("Ask what the largest commit contains, and what they changed after it.")
    if "build_fails" in flags:
        log = ((report or {}).get("build") or {}).get("logTail") or "the build failed"
        questions.append(f"Ask them to explain the build failure: {log.splitlines()[0][:180]}")
    if "claim_unsupported" in flags:
        questions.append("Ask them to open the file that implements the strongest claim on the resume.")
    if report and report.get("exists") and not flags:
        questions.append("Ask which part of the system they would rewrite first, and why.")
    questions.append("A human still makes the hiring decision. These questions are the gaps the evidence already shows.")
    return questions[:5]


async def llm_json(model: str, system: str, user: str) -> dict | None:
    key = os.environ.get("LLM_API_KEY")
    if not key:
        return None
    base = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    async with httpx.AsyncClient(timeout=40) as http:
        response = await http.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": model,
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
    import json
    return json.loads(content)


def review_prompt(persona: Reviewer, case: dict) -> str:
    title, lens = LENS[persona]
    job = case.get("job") or {}
    expectations = (job.get("personaExpectations") or {}).get(persona, "")
    role = (job.get("interviewerRoles") or {}).get(persona) or title
    return f"""You are the {role} on a hiring panel. Your lens is {lens}.
The interviewer who owns your seat wrote these expectations:
{expectations}
Job description
{(case.get("job") or {}).get("description", "")}
Rules
- Judge only from the case file. Never invent facts about the candidate.
- Every strength, drawback, and red flag must carry evidence, either a resume line or a repo flag or finding.
- Be adversarial but fair. A claim the code does not support is a red flag, not a drawback.
- Return JSON with persona, verdict, score, headline, strengths, drawbacks, redFlags.
- persona must be "{persona}". verdict is advance, maybe, or reject. score is 0 to 100.
"""


async def review_for(persona: Reviewer, case: dict) -> PersonaReview:
    model = os.environ.get("LLM_MODEL_FAST") or "gpt-4o-mini"
    try:
        raw = await llm_json(model, review_prompt(persona, case), json_dumps(case))
        if raw:
            raw["persona"] = persona
            return PersonaReview.model_validate(raw)
    except Exception as exc:
        print(f"review fallback for {persona}: {exc}")
    return deterministic_review(persona, case)


async def notes_for(persona: Reviewer, case: dict, reviews: list[PersonaReview]) -> list[CrossExamNote]:
    model = os.environ.get("LLM_MODEL_FAST") or "gpt-4o-mini"
    others = [review.model_dump() for review in reviews if review.persona != persona]
    try:
        raw = await llm_json(
            model,
            f"""You are the {LENS[persona][0]} in cross-examination.
Return JSON {{"notes": [{{"persona":"{persona}","targetPersona":"...","type":"challenge"|"concede"|"add","text":"..."}}]}}.
At most two notes. Challenge a softer verdict when the evidence is thin. Concede when you agree. Add a fact the other person missed.
Do not invent evidence.""",
            json_dumps({"case": case, "others": others}),
        )
        if raw and isinstance(raw.get("notes"), list):
            notes = [CrossExamNote.model_validate({**note, "persona": persona}) for note in raw["notes"][:2]]
            if notes:
                return notes
    except Exception as exc:
        print(f"cross-exam fallback for {persona}: {exc}")
    return deterministic_notes(persona, reviews)


async def report_for(case: dict, reviews: list[PersonaReview], notes: list[CrossExamNote]) -> PanelReport:
    model = os.environ.get("LLM_MODEL_SMART") or os.environ.get("LLM_MODEL_FAST") or "gpt-4o"
    try:
        raw = await llm_json(
            model,
            """You are the moderator. Return a PanelReport JSON object.
Include consensus, real disagreements, a panelScore, a recommendation of advance, maybe, or reject,
and up to 5 questionsForHR. Questions must target gaps already present in the evidence.
Do not invent facts. completedAt can be an empty string.""",
            json_dumps({
                "case": case,
                "reviews": [review.model_dump() for review in reviews],
                "crossExam": [note.model_dump() for note in notes],
            }),
        )
        if raw:
            raw["candidateId"] = case["candidateId"]
            raw["reviews"] = [review.model_dump() for review in reviews]
            raw["crossExam"] = [note.model_dump() for note in notes]
            raw["completedAt"] = datetime.now(timezone.utc).isoformat()
            return PanelReport.model_validate(raw)
    except Exception as exc:
        print(f"moderator fallback: {exc}")
    return deterministic_report(case, reviews, notes)


def json_dumps(payload: dict) -> str:
    import json
    return json.dumps(payload)


async def relay_post(name: str, channel: str, text: str) -> None:
    """Best-effort Agent Relay post. The room never depends on it."""
    if not os.environ.get("RELAY_API_KEY"):
        return
    try:
        from agent_relay import Relay  # type: ignore
    except Exception:
        return
    try:
        relay = Relay(name)
        poster = getattr(relay, "post", None)
        if poster is None:
            return
        result = poster(channel, text)
        if hasattr(result, "__await__"):
            await result
    except Exception as exc:
        print("relay post failed", exc)

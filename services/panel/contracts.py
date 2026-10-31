from typing import Literal

from pydantic import BaseModel, Field

Reviewer = Literal["project_manager", "staff_engineer", "associate_engineer"]
Persona = Literal["project_manager", "staff_engineer", "associate_engineer", "moderator"]
Verdict = Literal["advance", "maybe", "reject"]
NoteType = Literal["challenge", "concede", "add"]


class Finding(BaseModel):
    text: str
    evidence: str


class PersonaReview(BaseModel):
    persona: Reviewer
    verdict: Verdict
    score: int = Field(ge=0, le=100)
    headline: str
    strengths: list[Finding]
    drawbacks: list[Finding]
    redFlags: list[Finding]


class CrossExamNote(BaseModel):
    persona: Reviewer
    targetPersona: Reviewer
    type: NoteType
    text: str


class PanelReport(BaseModel):
    candidateId: str
    panelScore: int = Field(ge=0, le=100)
    recommendation: Verdict
    summary: str
    consensus: list[str]
    disagreements: list[str]
    questionsForHR: list[str]
    reviews: list[PersonaReview]
    crossExam: list[CrossExamNote]
    completedAt: str

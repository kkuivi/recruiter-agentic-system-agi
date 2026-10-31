import type { CaseFile } from "@proofhire/contracts";

const actorUrl = () => (process.env.TERSE_ACTOR_URL || process.env.ACTOR_URL || "http://127.0.0.1:8787").replace(/\/$/, "");

export async function actorCall(candidateId: string, method: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${actorUrl()}/actors/${candidateId}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => ({ ok: false, error: "actor returned invalid JSON" }));
  if (!response.ok) {
    const message = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : response.statusText;
    throw new Error(message);
  }
  return payload;
}

export async function startActor(candidateId: string, caseFile: CaseFile): Promise<void> {
  await actorCall(candidateId, "start", caseFile);
}

export async function startPanelService(candidateId: string): Promise<void> {
  const base = (process.env.PANEL_SERVICE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  const response = await fetch(`${base}/panels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidateId }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `panel service returned ${response.status}`);
  }
}

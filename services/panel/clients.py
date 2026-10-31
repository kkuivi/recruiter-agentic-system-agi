import httpx


class ActorClient:
    def __init__(self, http: httpx.AsyncClient, base: str):
        self.http = http
        self.base = base.rstrip("/")

    async def state(self, candidate_id: str) -> dict:
        response = await self.http.get(f"{self.base}/actors/{candidate_id}/state")
        response.raise_for_status()
        return response.json()

    async def call(self, candidate_id: str, method: str, body: dict) -> dict:
        response = await self.http.post(f"{self.base}/actors/{candidate_id}/{method}", json=body)
        payload = response.json()
        if response.status_code >= 400 or not payload.get("ok", False):
            raise RuntimeError(payload.get("error") or f"actor {method} failed")
        return payload


class OrchestratorClient:
    def __init__(self, http: httpx.AsyncClient, base: str):
        self.http = http
        self.base = base.rstrip("/")

    async def case_file(self, candidate_id: str) -> dict:
        response = await self.http.get(f"{self.base}/candidates/{candidate_id}/case")
        response.raise_for_status()
        return response.json()

    async def record_event(self, candidate_id: str, event: dict) -> None:
        response = await self.http.post(
            f"{self.base}/internal/candidates/{candidate_id}/events",
            json={"event": event},
        )
        response.raise_for_status()

    async def complete(self, candidate_id: str, report: dict) -> None:
        response = await self.http.post(
            f"{self.base}/internal/candidates/{candidate_id}/complete",
            json={"report": report},
        )
        response.raise_for_status()

    async def fail(self, candidate_id: str) -> None:
        await self.http.post(f"{self.base}/internal/candidates/{candidate_id}/fail")

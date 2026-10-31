import type { ClaimCheck, ProjectClaim, RepoReport } from "@proofhire/contracts";

const STOP = new Set(["with", "from", "that", "this", "into", "over", "around", "using", "their", "have", "will"]);

export function heuristicClaims(claim: ProjectClaim, corpus: string): ClaimCheck[] {
  const features = claim.claimedFeatures.length > 0 ? claim.claimedFeatures : claim.description ? [claim.description] : [];
  const haystack = corpus.toLowerCase();
  return features.map((feature) => {
    const tokens = feature
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((token) => token.length > 3 && !STOP.has(token));
    if (tokens.length === 0) {
      return { claim: feature, verdict: "unsupported" as const, evidence: "The claim has no checkable terms." };
    }
    const hits = tokens.filter((token) => haystack.includes(token));
    const ratio = hits.length / tokens.length;
    if (ratio >= 0.65) {
      return {
        claim: feature,
        verdict: "supported" as const,
        evidence: `Matched repository text: ${hits.join(", ")}.`,
      };
    }
    if (ratio >= 0.34) {
      return {
        claim: feature,
        verdict: "partial" as const,
        evidence: `Only some terms appear in the repository: ${hits.join(", ") || "none"}.`,
      };
    }
    return {
      claim: feature,
      verdict: "unsupported" as const,
      evidence: "No matching source or README text for this claim.",
    };
  });
}

export async function checkClaims(claim: ProjectClaim, corpus: string): Promise<ClaimCheck[]> {
  const fallback = heuristicClaims(claim, corpus);
  const key = process.env.LLM_API_KEY;
  if (!key || fallback.length === 0) return fallback;

  try {
    const base = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
    const model = process.env.LLM_MODEL_FAST || "gpt-4o-mini";
    const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You check resume claims against repository text. Return JSON {\"checks\":[{\"claim\":string,\"verdict\":\"supported\"|\"partial\"|\"unsupported\",\"evidence\":string}]}. One check per claimed feature, same order. Evidence is a short quote or file fact from the corpus. If you cannot find evidence, verdict is unsupported. Never guess.",
          },
          {
            role: "user",
            content: JSON.stringify({ features: claim.claimedFeatures, corpus: corpus.slice(0, 14000) }),
          },
        ],
      }),
    });
    if (!response.ok) return fallback;
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content;
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { checks?: ClaimCheck[] };
    if (!Array.isArray(parsed.checks) || parsed.checks.length !== fallback.length) return fallback;
    return parsed.checks.map((check, index) => ({
      claim: fallback[index]?.claim ?? check.claim,
      verdict: check.verdict === "supported" || check.verdict === "partial" ? check.verdict : "unsupported",
      evidence: String(check.evidence || "No evidence returned.").slice(0, 400),
    }));
  } catch {
    return fallback;
  }
}

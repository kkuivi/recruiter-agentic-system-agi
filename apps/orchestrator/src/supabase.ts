import type { PanelEvent, PanelReport } from "@proofhire/contracts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export async function mirrorEvent(candidateId: string, event: PanelEvent): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  const { error } = await sb.from("panel_events").upsert(
    {
      candidate_id: candidateId,
      seq: event.seq,
      kind: event.kind,
      persona: event.persona ?? null,
      payload: event.payload ?? null,
    },
    { onConflict: "candidate_id,seq" },
  );
  if (error) console.error("supabase event", error.message);
}

export async function mirrorPanel(report: PanelReport): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  const { error: reportError } = await sb.from("panel_reports").upsert({
    candidate_id: report.candidateId,
    panel_score: report.panelScore,
    recommendation: report.recommendation,
    report,
    completed_at: report.completedAt,
  });
  if (reportError) console.error("supabase report", reportError.message);
  const { error: statusError } = await sb.from("candidates").update({ status: "panel_done" }).eq("id", report.candidateId);
  if (statusError) console.error("supabase status", statusError.message);
}

export async function mirrorStatus(candidateId: string, status: string): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  const { error } = await sb.from("candidates").update({ status }).eq("id", candidateId);
  if (error) console.error("supabase status", error.message);
}

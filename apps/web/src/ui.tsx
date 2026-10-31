import { FLAG_LABEL, PERSONA_LABEL, type Persona, type Verdict } from "@proofhire/contracts";

export function tone(score: number | null | undefined): string {
  if (score == null) return "text-muted";
  if (score >= 75) return "text-good";
  if (score >= 40) return "text-warn";
  return "text-bad";
}

export function verdictTone(verdict: Verdict): string {
  if (verdict === "advance") return "bg-good-bg text-good";
  if (verdict === "maybe") return "bg-warn-bg text-warn";
  return "bg-bad-bg text-bad";
}

export function verdictLabel(verdict: Verdict): string {
  if (verdict === "advance") return "Advance";
  if (verdict === "maybe") return "Maybe";
  return "Reject";
}

export function personaLabel(persona: Persona): string {
  return PERSONA_LABEL[persona];
}

export function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function Score({ value, label, compact }: { value: number | null; label: string; compact?: boolean }) {
  return (
    <div className={compact ? "w-[6.4rem]" : "min-w-[4.5rem]"}>
      <div className={`font-serif leading-none tabular-nums ${tone(value)} ${compact ? "text-3xl" : "text-4xl"}`}>{value ?? "—"}</div>
      <div className={`mt-1 uppercase text-muted ${compact ? "text-[10px] tracking-[0.08em]" : "text-xs tracking-[0.14em]"}`}>{label}</div>
    </div>
  );
}

export function FlagChip({ flag, title }: { flag: string; title?: string }) {
  const label = FLAG_LABEL[flag] ?? flag.replaceAll("_", " ");
  return (
    <span title={title ?? label} className="inline-flex rounded-full bg-bad-bg px-2.5 py-1 text-xs font-semibold text-bad">
      {label}
    </span>
  );
}

export function StatusChip({ status }: { status: string }) {
  const live = status === "panel_running" || status === "screening";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${live ? "bg-warn-bg text-warn" : "bg-paper text-muted"}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${verdictTone(verdict)}`}>{verdictLabel(verdict)}</span>;
}

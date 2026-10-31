import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { aggregateFit } from "../packages/forensics/src/score.ts";
import type { ProjectClaim, RepoReport } from "../packages/contracts/src/index.ts";

interface Fixture {
  candidateId: string;
  relevance: number;
  summary: string;
  projects: ProjectClaim[];
  reports: RepoReport[];
}

const dir = path.resolve(import.meta.dir, "../seed/fixtures/screens");
const rows = readdirSync(dir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Fixture)
  .map((fixture) => {
    const agg = aggregateFit(fixture.relevance, fixture.reports);
    return { ...fixture, ...agg };
  })
  .sort((a, b) => b.fit - a.fit);

const names: Record<string, string> = {
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1": "Maya Chen",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2": "Jordan Hale",
  "cccccccc-cccc-4ccc-8ccc-ccccccccccc3": "Alex Rivera",
  "dddddddd-dddd-4ddd-8ddd-ddddddddddd4": "Samir Okonkwo",
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5": "Ellis Ward",
};

for (const [index, row] of rows.entries()) {
  const flags = [...new Set(row.reports.flatMap((report) => report.flags))];
  console.log(`${index + 1}. ${names[row.candidateId]}  fit ${row.fit}  rel ${row.relevance}  auth ${row.authenticity}  [${flags.join(", ")}]`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(rows.map((row) => names[row.candidateId]).join(",") === "Maya Chen,Jordan Hale,Alex Rivera,Samir Okonkwo,Ellis Ward", "rank order");
const alex = rows[2];
const maya = rows[0];
const samir = rows[3];
const ellis = rows[4];
assert(alex?.candidateId.startsWith("cccccccc") === true, "Alex is rank 3");
assert((alex?.authenticity ?? 100) < 40, "Alex authenticity drops");
assert((maya?.authenticity ?? 0) >= 90, "Maya authenticity stays high");
assert((ellis?.fit ?? 100) <= 40, "missing repos cap fit");
assert(samir?.reports.some((report) => report.flags.includes("fork_no_work")) === true, "Samir is an untouched fork");
assert(alex?.reports.some((report) => report.flags.includes("single_dump") && report.flags.includes("build_fails")) === true, "Alex dump and build");
console.log("score checks passed");

import { analyzeRepo } from "./analyze.ts";
import type { ProjectClaim } from "@proofhire/contracts";

const [repoUrl, username] = process.argv.slice(2);
if (!repoUrl || !username) {
  console.error("usage: bun run forensics <repoUrl> <githubUsername>");
  process.exit(1);
}

const name = repoUrl.replace(/\.git$/, "").split("/").filter(Boolean).pop() ?? "repo";
const claim: ProjectClaim = {
  name,
  description: "Repository submitted with the application",
  claimedTech: [],
  claimedFeatures: [],
  repoUrl,
  claimedDates: null,
};

const report = await analyzeRepo({ repoUrl, candidateGithubUsername: username, claim });
console.log(JSON.stringify(report, null, 2));

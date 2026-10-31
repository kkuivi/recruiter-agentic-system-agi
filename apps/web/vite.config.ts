import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: repoRoot,
  resolve: {
    alias: {
      "@proofhire/contracts": path.join(repoRoot, "packages/contracts/src/index.ts"),
      "@proofhire/forensics/score": path.join(repoRoot, "packages/forensics/src/score.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        rewrite: (value) => value.replace(/^\/api/, ""),
      },
    },
  },
});

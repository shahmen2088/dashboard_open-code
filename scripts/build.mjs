import { mkdir } from "node:fs/promises"
import { build } from "esbuild"

await mkdir("dist", { recursive: true })
await build({
  entryPoints: ["src/session-organizer.js"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/session-organizer.js",
  external: ["@opencode-ai/plugin"],
  sourcemap: false,
  legalComments: "none",
})

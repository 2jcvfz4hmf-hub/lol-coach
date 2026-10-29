// Compile l'app PC dans dist-app/ (processus principal, preload et fenêtre).
import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const common = { bundle: true, logLevel: "info", sourcemap: false, target: "es2022" };

await mkdir("dist-app/renderer", { recursive: true });
await Promise.all([
  build({ ...common, entryPoints: ["app/main.ts"], outfile: "dist-app/main.cjs", platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["app/preload.ts"], outfile: "dist-app/preload.cjs", platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["app/renderer/app.ts"], outfile: "dist-app/renderer/app.js", platform: "browser", format: "iife" }),
  cp("app/renderer/index.html", "dist-app/renderer/index.html"),
  cp("app/renderer/style.css", "dist-app/renderer/style.css"),
  cp("app/renderer/fonts", "dist-app/renderer/fonts", { recursive: true }),
]);

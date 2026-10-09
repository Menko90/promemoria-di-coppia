// Costruisce l'app in public/ (file statici pronti per Vercel).
// Uso: node scripts/build.mjs
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const extra = ["/opt/npm-tools/node_modules", "/opt/node-tools/node_modules"].filter(existsSync);
const nodePaths = [join(root, "node_modules"), ...extra].filter(existsSync);
const require = createRequire(join(nodePaths[0] ?? root, "noop.js"));
const esbuild = require("esbuild");

const out = join(root, "public", "assets");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const js = await esbuild.build({
  entryPoints: [join(root, "src/main.tsx")],
  bundle: true,
  format: "esm",
  minify: true,
  sourcemap: false,
  target: ["es2020", "chrome90", "safari15"],
  jsx: "automatic",
  external: ["https://*"],
  outdir: out,
  entryNames: "app.[hash]",
  nodePaths,
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  legalComments: "none",
  logLevel: "warning",
});
const css = await esbuild.build({
  entryPoints: [join(root, "src/styles.css")],
  bundle: true,
  minify: true,
  outdir: out,
  entryNames: "app.[hash]",
  metafile: true,
  logLevel: "warning",
});

const files = readdirSync(out);
const jsName = files.find((f) => f.endsWith(".js"));
const cssName = files.find((f) => f.endsWith(".css"));
const version = `${jsName}.${cssName}`.replace(/[^a-zA-Z0-9]/g, "").slice(-16);

writeFileSync(join(root, "public/index.html"),
  readFileSync(join(root, "src/index.html"), "utf8").replace("__JS__", jsName).replace("__CSS__", cssName));
writeFileSync(join(root, "public/sw.js"),
  readFileSync(join(root, "src/sw.js"), "utf8")
    .replace("__VERSION__", version)
    .replace("__ASSETS__", [`"/assets/${jsName}"`, `"/assets/${cssName}"`].join(", ")));

const size = (m) => Object.values(m.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`ok: ${jsName} (${(size(js.metafile) / 1024).toFixed(0)} KB), ${cssName} (${(size(css.metafile) / 1024).toFixed(0)} KB)`);

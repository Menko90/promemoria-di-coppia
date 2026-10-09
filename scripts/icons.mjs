// Genera le icone dell'app (PNG) a partire dal disegno vettoriale.
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const base = [join(root, "node_modules"), "/opt/npm-tools/node_modules"].find(existsSync);
const sharp = createRequire(join(base, "noop.js"))("sharp");
const dir = join(root, "public/icons");
mkdirSync(dir, { recursive: true });

const heart = (stroke, w) => `
  <path d="M256 392c-80-56-128-100-128-156 0-40 30-68 66-68 26 0 47 14 62 34 15-20 36-34 62-34 36 0 66 28 66 68 0 56-48 100-128 156z"
    fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round"/>
  <path d="M204 252l36 36 68-68" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

const full = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#B4235F"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})">${heart("#FFFFFF", 26)}</g>
</svg>`;
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#B4235F"/>${heart("#FFFFFF", 26)}
</svg>`;
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <g transform="translate(-40 -40) scale(1.16)">${heart("#FFFFFF", 34)}</g>
</svg>`;

const jobs = [
  ["icon-192.png", rounded, 192],
  ["icon-512.png", rounded, 512],
  ["maskable-512.png", full(56), 512],
  ["apple-touch-icon.png", full(20), 180],
  ["badge-96.png", badge, 96],
];
for (const [name, svg, size] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(dir, name));
}
console.log("icone pronte:", jobs.map((j) => j[0]).join(", "));

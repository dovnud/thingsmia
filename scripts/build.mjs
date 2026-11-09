import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const layout = readFileSync(join(root, "src/layout/gtag.html"), "utf8");
const pagesDir = join(root, "src/pages");
const distDir = join(root, "dist");

const NEW_ID = "G-PSF3VJTBDW";
const OLD_ID = "G-YVK8CJH848";
const idRe = /gtag\(\s*'config'\s*,\s*'(G-[A-Z0-9]+)'\s*\)/g;
const requiredIds = [...layout.matchAll(idRe)].map((match) => match[1]);

if (!requiredIds.includes(OLD_ID) || !requiredIds.includes(NEW_ID)) {
  console.error("src/layout/gtag.html must keep G-YVK8CJH848 and add G-PSF3VJTBDW");
  process.exit(1);
}

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (name.endsWith(".html")) files.push(path);
  }
  return files;
}

const callRe = /gtag\(\s*'config'\s*,\s*'G-[A-Z0-9]+'\s*\);/g;

function apply(html, rel) {
  if (html.includes(NEW_ID)) return { html, changed: false };

  const present = new Set([...html.matchAll(idRe)].map((match) => match[1]));
  const missing = requiredIds.filter((id) => !present.has(id));
  if (missing.length === 0) return { html, changed: false };

  const calls = [...html.matchAll(callRe)];
  if (calls.length === 0) {
    const head = html.indexOf("</head>");
    if (head === -1) throw new Error(`${rel}: no </head> for the shared gtag snippet`);
    const snippet = `${layout.trim()}\n`;
    return { html: html.slice(0, head) + snippet + html.slice(head), changed: true };
  }

  const last = calls[calls.length - 1];
  const spaced = /,\s+'/.test(last[0]);
  const inserted = missing
    .map((id) => (spaced ? `gtag('config', '${id}');` : `gtag('config','${id}');`))
    .join("");
  const at = last.index + last[0].length;
  const next = html.slice(0, at) + inserted + html.slice(at);
  if (next.slice(0, at) + next.slice(at + inserted.length) !== html) {
    throw new Error(`${rel}: analytics insert changed more than the extra config`);
  }
  return { html: next, changed: true };
}

const files = walk(pagesDir);
if (files.length === 0) {
  console.error("no HTML pages under src/pages");
  process.exit(1);
}

let changed = 0;
let unchanged = 0;
for (const file of files) {
  const rel = relative(pagesDir, file);
  const source = readFileSync(file, "utf8");
  const result = apply(source, rel);
  const configs = [...result.html.matchAll(idRe)].map((match) => match[1]);
  if (!configs.includes(OLD_ID)) throw new Error(`${rel}: dropped ${OLD_ID}`);
  if (configs.filter((id) => id === NEW_ID).length !== 1) {
    throw new Error(`${rel}: expected one ${NEW_ID} config`);
  }
  if (result.changed) changed += 1;
  else unchanged += 1;
  const out = join(distDir, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, result.html);
}

console.log(`built ${files.length} pages (${changed} updated, ${unchanged} already had ${NEW_ID})`);

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Mechanical copy sweep over user-visible strings. Code comments and non-UI
// strings are exempt by the bar, so we strip comments before scanning. What
// remains is JSX text and string literals, which is where shipped copy lives.

const ROOT = join(process.cwd());

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments, not the // in https://
}

// Files whose string content ships to a user: the whole frontend, plus the
// server routes and app that emit response copy.
const FILES = [
  ...walk(join(ROOT, "web", "src")),
  join(ROOT, "server", "app.ts"),
  join(ROOT, "server", "routes", "targets.ts"),
  join(ROOT, "server", "routes", "users.ts"),
  join(ROOT, "server", "routes", "places.ts"),
];

const BANNED_VOCAB = [
  "seamlessly",
  "effortlessly",
  "unlock",
  "elevate",
  "empower",
  "leverage",
  "robust",
  "dive in",
  "in today's fast-paced world",
  "we've got you covered",
];

const NEGATIVE_PHRASES = [
  "you don't have",
  "no results yet",
  "nothing here",
  "unable to",
  "something went wrong",
];

describe("copy sweep", () => {
  const scanned = FILES.map((f) => ({ file: f, text: stripComments(readFileSync(f, "utf8")) }));

  it("uses no em-dash or en-dash in shipped copy", () => {
    const hits = scanned.filter((s) => s.text.includes("—") || s.text.includes("–"));
    expect(hits.map((h) => h.file)).toEqual([]);
  });

  it("uses no banned LLM vocabulary", () => {
    const hits: string[] = [];
    for (const s of scanned) {
      const lower = s.text.toLowerCase();
      for (const word of BANNED_VOCAB) {
        if (lower.includes(word)) hits.push(`${word} in ${s.file}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("uses no negative empty-state phrasing", () => {
    const hits: string[] = [];
    for (const s of scanned) {
      const lower = s.text.toLowerCase();
      for (const phrase of NEGATIVE_PHRASES) {
        if (lower.includes(phrase)) hits.push(`${phrase} in ${s.file}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

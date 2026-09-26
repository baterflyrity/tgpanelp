#!/usr/bin/env node
/**
 * Generates static SVG badges (shields-style) from test results:
 *   badges/tests.svg      — "tests N passing" (green) or "tests N failing" (red)
 *   badges/coverage.svg   — "coverage NN%" with a green→red scale
 *
 * Inputs (produced by the CI test step):
 *   junit.xml                     — vitest junit reporter output
 *   coverage/coverage-summary.json— @vitest/coverage-v8 json-summary
 *
 * The SVGs are committed to the repo so GitHub renders them in the README.
 */

import fs from "node:fs";

const outDir = "badges";
fs.mkdirSync(outDir, { recursive: true });

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function badge(label, value, color) {
  // Flat shields.io-style badge, two segments sized roughly by text length.
  const lw = 6 + label.length * 6.5;
  const vw = 6 + value.length * 6.5;
  const w = lw + vw;
  const h = 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="${esc(label)}: ${esc(value)}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${w}" height="${h}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="${h}" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="${h}" fill="${color}"/>
    <rect width="${w}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="14" fill="#010101" fill-opacity=".3">${esc(label)}</text>
    <text x="${lw / 2}" y="13">${esc(label)}</text>
    <text x="${lw + vw / 2}" y="14" fill="#010101" fill-opacity=".3">${esc(value)}</text>
    <text x="${lw + vw / 2}" y="13">${esc(value)}</text>
  </g>
</svg>
`;
}

function coverageColor(pct) {
  if (pct >= 90) return "#4c1"; // bright green
  if (pct >= 75) return "#97ca00";
  if (pct >= 60) return "#dfb317";
  if (pct >= 40) return "#fe7d37";
  return "#e05d44";
}

// ── tests badge from junit.xml ──────────────────────────────────────────────
let tests = 0, failures = 0, errors = 0;
try {
  const junit = fs.readFileSync("junit.xml", "utf8");
  const m = junit.match(/<testsuite[^>]*>/);
  if (m) {
    const tag = m[0];
    tests = Number(tag.match(/tests="(\d+)"/)?.[1] ?? 0);
    failures = Number(tag.match(/failures="(\d+)"/)?.[1] ?? 0);
    errors = Number(tag.match(/errors="(\d+)"/)?.[1] ?? 0);
  }
} catch {
  console.warn("badges: junit.xml not found, tests badge will be unknown");
}

if (tests > 0) {
  const failed = failures + errors;
  const ok = failed === 0;
  fs.writeFileSync(
    `${outDir}/tests.svg`,
    badge("tests", ok ? `${tests} passing` : `${tests - failed}/${tests} passing`, ok ? "#4c1" : "#e05d44"),
  );
  console.log(`badges: tests.svg (${tests} tests, ${failed} failed)`);
} else {
  fs.writeFileSync(`${outDir}/tests.svg`, badge("tests", "unknown", "#9f9f9f"));
}

// ── coverage badge from coverage-summary.json ───────────────────────────────
let pct = null;
try {
  const summary = JSON.parse(fs.readFileSync("coverage/coverage-summary.json", "utf8"));
  pct = summary?.total?.statements?.pct ?? null;
} catch {
  console.warn("badges: coverage-summary.json not found, coverage badge will be unknown");
}

if (pct != null) {
  fs.writeFileSync(
    `${outDir}/coverage.svg`,
    badge("coverage", `${pct}%`, coverageColor(pct)),
  );
  console.log(`badges: coverage.svg (${pct}%)`);
} else {
  fs.writeFileSync(`${outDir}/coverage.svg`, badge("coverage", "unknown", "#9f9f9f"));
}

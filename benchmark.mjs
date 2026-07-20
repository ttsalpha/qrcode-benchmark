/**
 * benchmark.mjs — QR Code Library Benchmark
 * All libs pinned to ECL "M" for apples-to-apples comparison.
 * Run: node --expose-gc benchmark.mjs
 */

import { renderToString } from "react-dom/server";
import React from "react";
import { JSDOM } from "jsdom";
import { fork } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COLDSTART_WORKER = join(__dirname, "benchmark-coldstart.mjs");

// ─── Enforce --expose-gc ──────────────────────────────────────────────────────
if (!global.gc) {
  console.warn("WARNING: --expose-gc not available. Memory test will be skipped.");
  console.warn("  For accurate results: node --expose-gc benchmark.mjs");
}

// ─── JSDOM for qr-code-styling ───────────────────────────────────────────────
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.CanvasRenderingContext2D = dom.window.CanvasRenderingContext2D;

// ─── Imports ─────────────────────────────────────────────────────────────────
const { QRCode: TtsQRCode, toSVGString } = await import("@ttsalpha/qrcode");
const { QRCodeSVG } = await import("qrcode.react");
const { default: QRCodeStyling } = await import("qr-code-styling");
const { default: ReactQRCode } = await import("react-qr-code");
// Headless baseline — the most-downloaded QR lib on npm. No React component;
// compared through its async toString('svg') against toSVGString.
const { default: QRCodeLib } = await import("qrcode");

// ─── Pinned ECL ───────────────────────────────────────────────────────────────
// Defaults differ: @ttsalpha=M, qrcode.react=L, react-qr-code=L, qr-code-styling=Q
const ECL = "M";

// ─── Test data ────────────────────────────────────────────────────────────────
const DATA = {
  shortUrl: "https://example.com",
  longUrl:
    "https://example.com/products/qrcode?utm_source=benchmark&utm_medium=test&utm_campaign=comparison&ref=landing-page-2026",
  numeric: "01234567890123456789",
  alphaNum: "HELLO WORLD QR CODE 1234",
  unicode: "こんにちは世界 QRコード",
  vcard:
    "BEGIN:VCARD\nVERSION:3.0\nFN:John Doe\nEMAIL:contact@example.com\nURL:https://example.com\nEND:VCARD",
};

// Production-like SSR payloads — varied, unique-ish, includes heavy cases
const SSR_PAYLOADS = [
  DATA.shortUrl,
  DATA.longUrl,
  DATA.vcard,
  DATA.numeric,
  "https://shop.example.com/checkout?order=ORD-2026-88812&session=abc123xyz",
  "https://shop.example.com/checkout?order=ORD-2026-99901&session=def456uvw",
  "mailto:support@example.com",
  "tel:+15550001234",
  "WIFI:T:WPA;S:MyNetwork;P:password123;;",
  // Signed URL (large payload, high QR version)
  "https://cdn.example.com/files/report-q2-2026.pdf?X-Signature=abc123&X-Expires=1751234567&X-Key=prod-key-01&X-User=user_42",
  // Deep-link JSON-like
  "https://app.example.com/open?payload=eyJ0eXBlIjoib3JkZXIiLCJpZCI6Ijg4ODEyIiwic3RvcmUiOiJzZy0wMSJ9",
  // Full vCard (heavier)
  "BEGIN:VCARD\nVERSION:3.0\nFN:Jane Smith\nORG:Example Corp\nTEL:+15550009876\nEMAIL:jane@example.com\nADR:;;123 Main St;Springfield;IL;62701;USA\nURL:https://example.com/jane\nEND:VCARD",
];

const WARMUP = 20;

function gcIfPossible() {
  if (global.gc) global.gc();
}
function heapMB() {
  gcIfPossible();
  return process.memoryUsage().heapUsed / 1024 / 1024;
}
function fmt(n, d = 2) {
  return Number(n.toFixed(d));
}
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function p95(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.ceil(s.length * 0.95) - 1];
}
function p99(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.ceil(s.length * 0.99) - 1];
}

// ─── TEST 1: Throughput — unique input per iteration ─────────────────────────
// Uses unique value each render to prevent any lib from gaining advantage via
// value-level caching. More representative of production (varied QR content).
function measureThroughput(label, fn, durationMs = 3000) {
  for (let i = 0; i < WARMUP; i++) fn(`https://example.com/w/${i}`);
  gcIfPossible();
  let count = 0;
  const end = performance.now() + durationMs;
  while (performance.now() < end) {
    fn(`https://example.com/p/${count++}`);
  }
  const rps = fmt(count / (durationMs / 1000), 0);
  console.log(`  ${label}: ${rps.toLocaleString()} renders/sec`);
  return rps;
}

async function measureThroughputAsync(label, fn, durationMs = 3000) {
  for (let i = 0; i < 5; i++) await fn(`https://example.com/w/${i}`);
  gcIfPossible();
  let count = 0;
  const end = performance.now() + durationMs;
  while (performance.now() < end) {
    await fn(`https://example.com/p/${count++}`);
  }
  const rps = fmt(count / (durationMs / 1000), 0);
  console.log(`  ${label}: ${rps.toLocaleString()} renders/sec`);
  return rps;
}

// ─── TEST 2: Data complexity ──────────────────────────────────────────────────
// Unique input per sample: a fixed-length digit suffix keeps the encoding mode
// (digits are valid in numeric/alphanumeric/byte) and the QR version stable
// while defeating value-level caches (@ttsalpha/qrcode ≥2.4 has a 16-entry LRU).
function uniqueSuffix(i) {
  return String(i % 100).padStart(2, "0");
}

function benchDataTypes(fn) {
  const results = {};
  for (const [type, value] of Object.entries(DATA)) {
    for (let i = 0; i < WARMUP; i++) fn(value + uniqueSuffix(i));
    gcIfPossible();
    const times = [];
    for (let i = 0; i < 500; i++) {
      const input = value + uniqueSuffix(i);
      const t0 = performance.now();
      fn(input);
      times.push(performance.now() - t0);
    }
    results[type] = {
      medianMs: fmt(median(times), 3),
      p95Ms: fmt(p95(times), 3),
      p99Ms: fmt(p99(times), 3),
    };
  }
  return results;
}

async function benchDataTypesAsync(fn) {
  const results = {};
  for (const [type, value] of Object.entries(DATA)) {
    for (let i = 0; i < WARMUP; i++) await fn(value + uniqueSuffix(i));
    gcIfPossible();
    const times = [];
    for (let i = 0; i < 500; i++) {
      const input = value + uniqueSuffix(i);
      const t0 = performance.now();
      await fn(input);
      times.push(performance.now() - t0);
    }
    results[type] = {
      medianMs: fmt(median(times), 3),
      p95Ms: fmt(p95(times), 3),
      p99Ms: fmt(p99(times), 3),
    };
  }
  return results;
}

// ─── TEST 3: Memory stability ─────────────────────────────────────────────────
function benchMemory(fn, count = 5000) {
  for (let i = 0; i < WARMUP; i++) fn(`https://example.com/m/${i}`);
  gcIfPossible();
  const before = heapMB();
  const snapshots = [before];
  for (let i = 0; i < count; i++) {
    fn(`https://example.com/m/${i}`);
    if (i % 500 === 0) snapshots.push(heapMB());
  }
  gcIfPossible();
  const after = heapMB();
  return {
    baselineMB: fmt(before),
    peakMB: fmt(Math.max(...snapshots)),
    finalMB: fmt(after),
    driftMB: fmt(after - before),
  };
}

async function benchMemoryAsync(fn, count = 5000) {
  for (let i = 0; i < WARMUP; i++) await fn(`https://example.com/m/${i}`);
  gcIfPossible();
  const before = heapMB();
  const snapshots = [before];
  for (let i = 0; i < count; i++) {
    await fn(`https://example.com/m/${i}`);
    if (i % 500 === 0) snapshots.push(heapMB());
  }
  gcIfPossible();
  const after = heapMB();
  return {
    baselineMB: fmt(before),
    peakMB: fmt(Math.max(...snapshots)),
    finalMB: fmt(after),
    driftMB: fmt(after - before),
  };
}

// ─── TEST 4: Styled QR ────────────────────────────────────────────────────────
// ECL=H required in production when a logo occludes the center (30%+ coverage).
// This is the most realistic styled QR scenario.
const STYLED_PROPS_TTS = {
  value: "https://example.com",
  errorCorrectionLevel: "H", // H required with logo
  size: 512,
  dotStyle: "rounded",
  dotColor: "#1a1a2e",
  backgroundColor: "#ffffff",
  corner: {
    square: { style: "extra-rounded", color: "#16213e" },
    dot: { style: "circle", color: "#0f3460" },
  },
};
const STYLED_OPTS_STYLING = {
  data: "https://example.com",
  type: "svg",
  width: 512,
  height: 512,
  qrOptions: { errorCorrectionLevel: "H" }, // H required with logo
  dotsOptions: { type: "rounded", color: "#1a1a2e" },
  cornersSquareOptions: { type: "extra-rounded", color: "#16213e" },
  cornersDotOptions: { type: "dot", color: "#0f3460" },
};

// Unique value per render — same cache-busting rule as TEST 2, applied to
// every lib for symmetry.
function benchStyledTts(count = 500) {
  const props = (i) => ({
    ...STYLED_PROPS_TTS,
    value: STYLED_PROPS_TTS.value + "/" + uniqueSuffix(i),
  });
  for (let i = 0; i < WARMUP; i++) renderToString(React.createElement(TtsQRCode, props(i)));
  gcIfPossible();
  const t0 = performance.now();
  for (let i = 0; i < count; i++) renderToString(React.createElement(TtsQRCode, props(i)));
  return fmt((performance.now() - t0) / count, 3);
}

function benchStyledTtsUtil(count = 500) {
  const props = (i) => ({
    ...STYLED_PROPS_TTS,
    value: STYLED_PROPS_TTS.value + "/" + uniqueSuffix(i),
  });
  for (let i = 0; i < WARMUP; i++) toSVGString(props(i));
  gcIfPossible();
  const t0 = performance.now();
  for (let i = 0; i < count; i++) toSVGString(props(i));
  return fmt((performance.now() - t0) / count, 3);
}

async function benchStyledStyling(count = 100) {
  const opts = (i) => ({
    ...STYLED_OPTS_STYLING,
    data: STYLED_OPTS_STYLING.data + "/" + uniqueSuffix(i),
  });
  for (let i = 0; i < 5; i++) {
    const q = new QRCodeStyling(opts(i));
    await q.getRawData("svg");
  }
  gcIfPossible();
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    const q = new QRCodeStyling(opts(i));
    await q.getRawData("svg");
  }
  return fmt((performance.now() - t0) / count, 3);
}

// ─── TEST 5: SSR simulation ───────────────────────────────────────────────────
// Every render gets a unique payload variant (12 base payloads × per-render
// digit suffix) so the 16-entry LRU in @ttsalpha/qrcode ≥2.4 never hits.
function benchSSR(Component, makeProps, rounds = 10) {
  let uniq = 0;
  for (let i = 0; i < WARMUP; i++) {
    renderToString(
      React.createElement(
        Component,
        makeProps(SSR_PAYLOADS[i % SSR_PAYLOADS.length] + uniqueSuffix(uniq++)),
      ),
    );
  }
  const allTimes = [];
  for (let r = 0; r < rounds; r++) {
    gcIfPossible();
    const t0 = performance.now();
    for (const payload of SSR_PAYLOADS) {
      renderToString(React.createElement(Component, makeProps(payload + uniqueSuffix(uniq++))));
    }
    allTimes.push((performance.now() - t0) / SSR_PAYLOADS.length);
  }
  return {
    medianMs: fmt(median(allTimes), 3),
    p95Ms: fmt(p95(allTimes), 3),
    p99Ms: fmt(p99(allTimes), 3),
  };
}

function benchSSRUtil(fn, rounds = 10) {
  let uniq = 0;
  for (let i = 0; i < WARMUP; i++) fn(SSR_PAYLOADS[i % SSR_PAYLOADS.length] + uniqueSuffix(uniq++));
  const allTimes = [];
  for (let r = 0; r < rounds; r++) {
    gcIfPossible();
    const t0 = performance.now();
    for (const payload of SSR_PAYLOADS) fn(payload + uniqueSuffix(uniq++));
    allTimes.push((performance.now() - t0) / SSR_PAYLOADS.length);
  }
  return {
    medianMs: fmt(median(allTimes), 3),
    p95Ms: fmt(p95(allTimes), 3),
    p99Ms: fmt(p99(allTimes), 3),
  };
}

async function benchSSRUtilAsync(fn, rounds = 10) {
  let uniq = 0;
  for (let i = 0; i < WARMUP; i++)
    await fn(SSR_PAYLOADS[i % SSR_PAYLOADS.length] + uniqueSuffix(uniq++));
  const allTimes = [];
  for (let r = 0; r < rounds; r++) {
    gcIfPossible();
    const t0 = performance.now();
    for (const payload of SSR_PAYLOADS) await fn(payload + uniqueSuffix(uniq++));
    allTimes.push((performance.now() - t0) / SSR_PAYLOADS.length);
  }
  return {
    medianMs: fmt(median(allTimes), 3),
    p95Ms: fmt(p95(allTimes), 3),
    p99Ms: fmt(p99(allTimes), 3),
  };
}

// ─── TEST 6: Sequential batch — N renders in one tick ────────────────────────
// Node.js is single-threaded: "concurrent" React renders are always sequential.
// This measures real SSR server throughput under a burst of N simultaneous
// page requests — the bottleneck is render time, not I/O.
// NOTE: True parallelism requires worker_threads (separate test).
async function benchSequentialBatch(fn, batchSize = 100, rounds = 20) {
  let uniq = 0;
  for (let i = 0; i < WARMUP; i++) fn(SSR_PAYLOADS[i % SSR_PAYLOADS.length] + uniqueSuffix(uniq++));
  gcIfPossible();

  const batchTimes = [];
  for (let r = 0; r < rounds; r++) {
    gcIfPossible();
    const t0 = performance.now();
    for (let i = 0; i < batchSize; i++) {
      fn(SSR_PAYLOADS[i % SSR_PAYLOADS.length] + uniqueSuffix(uniq++));
    }
    batchTimes.push(performance.now() - t0);
  }
  return {
    batchSize,
    medianBatchMs: fmt(median(batchTimes), 2),
    p95BatchMs: fmt(p95(batchTimes), 2),
    avgPerRenderMs: fmt(median(batchTimes) / batchSize, 3),
  };
}

async function benchSequentialBatchAsync(fn, batchSize = 20, rounds = 10) {
  let uniq = 0;
  for (let i = 0; i < 5; i++)
    await fn(SSR_PAYLOADS[i % SSR_PAYLOADS.length] + uniqueSuffix(uniq++));
  gcIfPossible();
  const batchTimes = [];
  for (let r = 0; r < rounds; r++) {
    gcIfPossible();
    const t0 = performance.now();
    for (let i = 0; i < batchSize; i++) {
      await fn(SSR_PAYLOADS[i % SSR_PAYLOADS.length] + uniqueSuffix(uniq++));
    }
    batchTimes.push(performance.now() - t0);
  }
  return {
    batchSize,
    medianBatchMs: fmt(median(batchTimes), 2),
    p95BatchMs: fmt(p95(batchTimes), 2),
    avgPerRenderMs: fmt(median(batchTimes) / batchSize, 3),
  };
}

// ─── TEST 7: True cold start — child_process.fork ────────────────────────────
// Each round = fresh Node.js process → import lib → render (no prior JIT warmup).
// Represents: Lambda cold start, edge function first invocation, Next.js SSR boot.
function spawnColdStartWorker(lib) {
  return new Promise((resolve, reject) => {
    const child = fork(COLDSTART_WORKER, [], {
      env: { ...process.env, COLD_LIB: lib, COLD_ECL: ECL, COLD_ROUNDS: "5" },
      execArgv: process.execArgv,
    });
    let result = null;
    child.on("message", (msg) => {
      result = msg;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (result?.error) reject(new Error(result.error));
      else if (code !== 0) reject(new Error(`worker exited ${code}`));
      else resolve(result);
    });
  });
}

async function benchTrueColdStart(lib, rounds = 10) {
  const importMsList = [];
  const firstRenderList = [];
  const secondRenderList = [];
  for (let r = 0; r < rounds; r++) {
    const res = await spawnColdStartWorker(lib);
    importMsList.push(res.importMs);
    firstRenderList.push(res.renders[0]);
    if (res.renders[1] !== undefined) secondRenderList.push(res.renders[1]);
  }
  return {
    importMedianMs: fmt(median(importMsList), 2),
    importP95Ms: fmt(p95(importMsList), 2),
    firstRenderMedianMs: fmt(median(firstRenderList), 3),
    firstRenderP95Ms: fmt(p95(firstRenderList), 3),
    secondRenderMedianMs: secondRenderList.length ? fmt(median(secondRenderList), 3) : null,
  };
}

// ─── TEST 8: Repeated value — same input every render ────────────────────────
// Production scenario: the same QR re-rendered across requests/mounts (POS
// receipts, kiosk screens). @ttsalpha/qrcode ≥2.4 memoizes matrices in a
// 16-entry LRU, so this is expected to favor it heavily — the point of this
// test is to quantify that, clearly labeled. All libs run the same pattern.
function measureRepeatedValue(label, fn, durationMs = 2000) {
  const value = "https://example.com/repeated-value-test";
  for (let i = 0; i < WARMUP; i++) fn(value);
  gcIfPossible();
  let count = 0;
  const end = performance.now() + durationMs;
  while (performance.now() < end) {
    fn(value);
    count++;
  }
  const rps = fmt(count / (durationMs / 1000), 0);
  console.log(`  ${label}: ${rps.toLocaleString()} renders/sec`);
  return rps;
}

async function measureRepeatedValueAsync(label, fn, durationMs = 2000) {
  const value = "https://example.com/repeated-value-test";
  for (let i = 0; i < 5; i++) await fn(value);
  gcIfPossible();
  let count = 0;
  const end = performance.now() + durationMs;
  while (performance.now() < end) {
    await fn(value);
    count++;
  }
  const rps = fmt(count / (durationMs / 1000), 0);
  console.log(`  ${label}: ${rps.toLocaleString()} renders/sec`);
  return rps;
}

// ─── Feature scoring ──────────────────────────────────────────────────────────
const FEATURES = {
  svgOutput: {
    qrcode: true,
    "@ttsalpha/qrcode": true,
    "qrcode.react": true,
    "qr-code-styling": true,
    "react-qr-code": true,
  },
  canvasOutput: {
    qrcode: true,
    "@ttsalpha/qrcode": false,
    "qrcode.react": true,
    "qr-code-styling": true,
    "react-qr-code": false,
  },
  pngExport: {
    qrcode: true,
    "@ttsalpha/qrcode": true,
    "qrcode.react": false,
    "qr-code-styling": true,
    "react-qr-code": false,
  },
  toSVGString: {
    qrcode: true,
    "@ttsalpha/qrcode": true,
    "qrcode.react": false,
    "qr-code-styling": false,
    "react-qr-code": false,
  },
  ssrSafe: {
    qrcode: true,
    "@ttsalpha/qrcode": true,
    "qrcode.react": true,
    "qr-code-styling": false,
    "react-qr-code": true,
  },
  zeroDeps: {
    qrcode: false,
    "@ttsalpha/qrcode": true,
    "qrcode.react": true,
    "qr-code-styling": false,
    "react-qr-code": false,
  },
  dotStyles: {
    qrcode: false,
    "@ttsalpha/qrcode": true,
    "qrcode.react": false,
    "qr-code-styling": true,
    "react-qr-code": false,
  },
  cornerStyles: {
    qrcode: false,
    "@ttsalpha/qrcode": true,
    "qrcode.react": false,
    "qr-code-styling": true,
    "react-qr-code": false,
  },
  logoImage: {
    qrcode: false,
    "@ttsalpha/qrcode": true,
    "qrcode.react": true,
    "qr-code-styling": true,
    "react-qr-code": false,
  },
  logoReactNode: {
    qrcode: false,
    "@ttsalpha/qrcode": true,
    "qrcode.react": false,
    "qr-code-styling": false,
    "react-qr-code": false,
  },
  ecLevel: {
    qrcode: true,
    "@ttsalpha/qrcode": true,
    "qrcode.react": true,
    "qr-code-styling": true,
    "react-qr-code": true,
  },
  versionControl: {
    qrcode: true,
    "@ttsalpha/qrcode": true,
    "qrcode.react": true,
    "qr-code-styling": true,
    "react-qr-code": false,
  },
  typescript: {
    qrcode: false,
    "@ttsalpha/qrcode": true,
    "qrcode.react": true,
    "qr-code-styling": true,
    "react-qr-code": true,
  },
  esm: {
    qrcode: false,
    "@ttsalpha/qrcode": true,
    "qrcode.react": true,
    "qr-code-styling": false,
    "react-qr-code": true,
  },
  react18plus: {
    qrcode: true,
    "@ttsalpha/qrcode": true,
    "qrcode.react": true,
    "qr-code-styling": true,
    "react-qr-code": true,
  },
  react16support: {
    qrcode: true,
    "@ttsalpha/qrcode": false,
    "qrcode.react": true,
    "qr-code-styling": true,
    "react-qr-code": true,
  },
  accessibility: {
    qrcode: false,
    "@ttsalpha/qrcode": true,
    "qrcode.react": true,
    "qr-code-styling": false,
    "react-qr-code": true,
  },
};

function computeScores() {
  const libs = ["@ttsalpha/qrcode", "qrcode.react", "qr-code-styling", "react-qr-code", "qrcode"];
  const scores = Object.fromEntries(libs.map((l) => [l, 0]));
  for (const feat of Object.values(FEATURES)) {
    for (const lib of libs) {
      if (feat[lib]) scores[lib]++;
    }
  }
  return scores;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
console.log("🔬 QR Code Library Benchmark\n");
console.log("Node:", process.version, "| Date:", new Date().toISOString());
console.log(`ECL pinned to "${ECL}" (styled QR uses "H" — logo-safe)`);
console.log("─".repeat(60));

console.log("\n[1/8] Throughput — unique input per render (3s each)");
console.log("  Note: unique value per call; no lib can benefit from caching");
const tput = {
  "@ttsalpha/qrcode (React)": measureThroughput("@ttsalpha (React)", (v) =>
    renderToString(
      React.createElement(TtsQRCode, { value: v, errorCorrectionLevel: ECL, size: 256 }),
    ),
  ),
  "@ttsalpha/qrcode (toSVGStr)": measureThroughput("@ttsalpha (util)", (v) =>
    toSVGString({ value: v, errorCorrectionLevel: ECL, size: 256 }),
  ),
  "qrcode.react (SVG)": measureThroughput("qrcode.react", (v) =>
    renderToString(React.createElement(QRCodeSVG, { value: v, level: ECL, size: 256 })),
  ),
  "react-qr-code": measureThroughput("react-qr-code", (v) =>
    renderToString(React.createElement(ReactQRCode, { value: v, level: ECL, size: 256 })),
  ),
  "qr-code-styling": await measureThroughputAsync("qr-code-styling", async (v) => {
    const q = new QRCodeStyling({
      data: v,
      type: "svg",
      width: 256,
      height: 256,
      qrOptions: { errorCorrectionLevel: ECL },
    });
    await q.getRawData("svg");
  }),
  "qrcode (headless)": await measureThroughputAsync("qrcode (headless)", (v) =>
    QRCodeLib.toString(v, { type: "svg", width: 256, errorCorrectionLevel: ECL }),
  ),
};

console.log("\n[2/8] Data complexity — 500 samples per type, unique input, p99 included");
const complexity = {
  "@ttsalpha/qrcode (React)": benchDataTypes((v) =>
    renderToString(
      React.createElement(TtsQRCode, { value: v, errorCorrectionLevel: ECL, size: 256 }),
    ),
  ),
  "@ttsalpha/qrcode (toSVGStr)": benchDataTypes((v) =>
    toSVGString({ value: v, errorCorrectionLevel: ECL, size: 256 }),
  ),
  "qrcode.react (SVG)": benchDataTypes((v) =>
    renderToString(React.createElement(QRCodeSVG, { value: v, level: ECL, size: 256 })),
  ),
  "react-qr-code": benchDataTypes((v) =>
    renderToString(React.createElement(ReactQRCode, { value: v, level: ECL, size: 256 })),
  ),
  "qrcode (headless)": await benchDataTypesAsync((v) =>
    QRCodeLib.toString(v, { type: "svg", width: 256, errorCorrectionLevel: ECL }),
  ),
};
console.log("  Done.");

console.log("\n[3/8] Memory stability — 5000 renders, unique input");
let memStability = null;
if (!global.gc) {
  console.log("  Skipped — requires --expose-gc (not available in this environment)");
} else {
  memStability = {
    "@ttsalpha/qrcode (React)": benchMemory((v) =>
      renderToString(
        React.createElement(TtsQRCode, { value: v, errorCorrectionLevel: ECL, size: 256 }),
      ),
    ),
    "@ttsalpha/qrcode (toSVGStr)": benchMemory((v) =>
      toSVGString({ value: v, errorCorrectionLevel: ECL, size: 256 }),
    ),
    "qrcode.react (SVG)": benchMemory((v) =>
      renderToString(React.createElement(QRCodeSVG, { value: v, level: ECL, size: 256 })),
    ),
    "react-qr-code": benchMemory((v) =>
      renderToString(React.createElement(ReactQRCode, { value: v, level: ECL, size: 256 })),
    ),
    "qrcode (headless)": await benchMemoryAsync((v) =>
      QRCodeLib.toString(v, { type: "svg", width: 256, errorCorrectionLevel: ECL }),
    ),
  };
  for (const [k, v] of Object.entries(memStability)) {
    console.log(
      `  ${k}: baseline=${v.baselineMB}MB peak=${v.peakMB}MB final=${v.finalMB}MB drift=${v.driftMB}MB`,
    );
  }
}

console.log(
  "\n[4/8] Styled QR — ECL=H + size=512, unique input (production: logo occludes center)",
);
const styled = {
  "@ttsalpha/qrcode (React)": benchStyledTts(),
  "@ttsalpha/qrcode (toSVGStr)": benchStyledTtsUtil(),
  "qr-code-styling": await benchStyledStyling(100),
  "qrcode.react (SVG)": null,
  "react-qr-code": null,
  "qrcode (headless)": null,
};
for (const [k, v] of Object.entries(styled)) {
  console.log(`  ${k}: ${v === null ? "— (no styling API)" : v + "ms"}`);
}

console.log(
  "\n[5/8] SSR simulation — 12 varied payloads, unique per render, 10 rounds, p99 included",
);
const ssr = {
  "@ttsalpha/qrcode (React)": benchSSR(TtsQRCode, (v) => ({
    value: v,
    errorCorrectionLevel: ECL,
    size: 256,
  })),
  "@ttsalpha/qrcode (toSVGStr)": benchSSRUtil((v) =>
    toSVGString({ value: v, errorCorrectionLevel: ECL, size: 256 }),
  ),
  "qrcode.react (SVG)": benchSSR(QRCodeSVG, (v) => ({ value: v, level: ECL, size: 256 })),
  "react-qr-code": benchSSR(ReactQRCode, (v) => ({ value: v, level: ECL, size: 256 })),
  "qrcode (headless)": await benchSSRUtilAsync((v) =>
    QRCodeLib.toString(v, { type: "svg", width: 256, errorCorrectionLevel: ECL }),
  ),
};
for (const [k, v] of Object.entries(ssr))
  console.log(`  ${k}: median=${v.medianMs}ms p95=${v.p95Ms}ms p99=${v.p99Ms}ms`);

console.log("\n[6/8] Sequential batch — burst of N renders (single thread, production SSR)");
console.log('  Note: Node.js is single-threaded; "concurrent" React renders are sequential.');
console.log("  True parallelism requires worker_threads (not included here).");
const batch = {
  "@ttsalpha/qrcode (React)": await benchSequentialBatch(
    (v) =>
      renderToString(
        React.createElement(TtsQRCode, { value: v, errorCorrectionLevel: ECL, size: 256 }),
      ),
    100,
    20,
  ),
  "@ttsalpha/qrcode (toSVGStr)": await benchSequentialBatch(
    (v) => toSVGString({ value: v, errorCorrectionLevel: ECL, size: 256 }),
    100,
    20,
  ),
  "qrcode.react (SVG)": await benchSequentialBatch(
    (v) => renderToString(React.createElement(QRCodeSVG, { value: v, level: ECL, size: 256 })),
    100,
    20,
  ),
  "react-qr-code": await benchSequentialBatch(
    (v) => renderToString(React.createElement(ReactQRCode, { value: v, level: ECL, size: 256 })),
    100,
    20,
  ),
  "qr-code-styling": await benchSequentialBatchAsync(
    async (v) => {
      const q = new QRCodeStyling({
        data: v,
        type: "svg",
        width: 256,
        height: 256,
        qrOptions: { errorCorrectionLevel: ECL },
      });
      await q.getRawData("svg");
    },
    20,
    10,
  ),
  "qrcode (headless)": await benchSequentialBatchAsync(
    (v) => QRCodeLib.toString(v, { type: "svg", width: 256, errorCorrectionLevel: ECL }),
    100,
    20,
  ),
};
for (const [k, v] of Object.entries(batch)) {
  console.log(
    `  ${k}: batch=${v.batchSize} median=${v.medianBatchMs}ms p95=${v.p95BatchMs}ms avg/render=${v.avgPerRenderMs}ms`,
  );
}

console.log("\n[7/8] True cold start — fresh process per round (10 rounds each)");
console.log("  Each round: new Node process → import lib → render (no prior JIT warmup).");
console.log("  Represents: Lambda cold start, edge function first invocation.");
const coldStartLibs = [
  ["@ttsalpha/qrcode (toSVGStr)", "ttsalpha-util"],
  ["@ttsalpha/qrcode (React)", "ttsalpha-react"],
  ["qrcode.react", "qrcode.react"],
  ["react-qr-code", "react-qr-code"],
  ["qr-code-styling", "qr-code-styling"],
  ["qrcode (headless)", "qrcode"],
];
const coldStart = {};
for (const [label, lib] of coldStartLibs) {
  process.stdout.write(`  ${label}... `);
  const r = await benchTrueColdStart(lib, 10);
  coldStart[label] = r;
  console.log(
    `import=${r.importMedianMs}ms (p95=${r.importP95Ms}ms) ` +
      `first=${r.firstRenderMedianMs}ms (p95=${r.firstRenderP95Ms}ms) ` +
      `second=${r.secondRenderMedianMs}ms`,
  );
}

console.log("\n[8/8] Repeated value — same input every render (2s each)");
console.log("  Note: measures value-level caching (@ttsalpha ≥2.4 has a 16-entry LRU).");
console.log("  Expected to favor @ttsalpha by design — kept separate from cold-path tests.");
const repeated = {
  "@ttsalpha/qrcode (React)": measureRepeatedValue("@ttsalpha (React)", (v) =>
    renderToString(
      React.createElement(TtsQRCode, { value: v, errorCorrectionLevel: ECL, size: 256 }),
    ),
  ),
  "@ttsalpha/qrcode (toSVGStr)": measureRepeatedValue("@ttsalpha (util)", (v) =>
    toSVGString({ value: v, errorCorrectionLevel: ECL, size: 256 }),
  ),
  "qrcode.react (SVG)": measureRepeatedValue("qrcode.react", (v) =>
    renderToString(React.createElement(QRCodeSVG, { value: v, level: ECL, size: 256 })),
  ),
  "react-qr-code": measureRepeatedValue("react-qr-code", (v) =>
    renderToString(React.createElement(ReactQRCode, { value: v, level: ECL, size: 256 })),
  ),
  "qr-code-styling": await measureRepeatedValueAsync("qr-code-styling", async (v) => {
    const q = new QRCodeStyling({
      data: v,
      type: "svg",
      width: 256,
      height: 256,
      qrOptions: { errorCorrectionLevel: ECL },
    });
    await q.getRawData("svg");
  }),
  "qrcode (headless)": await measureRepeatedValueAsync("qrcode (headless)", (v) =>
    QRCodeLib.toString(v, { type: "svg", width: 256, errorCorrectionLevel: ECL }),
  ),
};

const scores = computeScores();

const output = {
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  eclLevel: ECL,
  note: "Styled QR uses ECL=H (logo-safe). Throughput uses unique input per render. Cold start uses child_process.fork.",
  throughput: tput,
  dataComplexity: complexity,
  memoryStability: memStability,
  styledQR_avgMsPerRender: styled,
  ssrSimulation: ssr,
  sequentialBatch: batch,
  trueColdStart: coldStart,
  repeatedValue: repeated,
  featureScores: scores,
  features: FEATURES,
};

console.log("\n" + "═".repeat(60));
console.log("RESULTS JSON:");
console.log(JSON.stringify(output, null, 2));

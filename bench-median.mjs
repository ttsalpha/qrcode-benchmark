// bench-median.mjs — run the benchmark N times and report the per-metric median.
// Usage: node bench-median.mjs [runs] [outFile]   (default: 3, median.local.json)
// Local default is gitignored (*.local.*); CI passes a clean name (ephemeral runner).
// Used both locally (pnpm run bench:median) and in CI.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const RUNS = Number(process.argv[2]) || 3;
const OUT = process.argv[3] || "median.local.json";
const MARKER = "RESULTS JSON:";

const median = (nums) => {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// round to 3 decimals but keep ints as ints
const round3 = (n) => Number(n.toFixed(3));

// numeric leaves → median across runs; strings/booleans/null → first run's value
const mergeMedian = (values) => {
  const first = values[0];
  if (typeof first === "number") {
    return round3(median(values.filter((v) => typeof v === "number")));
  }
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const out = {};
    for (const key of Object.keys(first)) {
      out[key] = mergeMedian(values.map((v) => v?.[key]));
    }
    return out;
  }
  return first;
};

const extractJson = (out) => {
  const at = out.indexOf(MARKER);
  if (at === -1) throw new Error("no RESULTS JSON block in benchmark output");
  return JSON.parse(out.slice(at + MARKER.length));
};

const runs = [];
for (let i = 1; i <= RUNS; i++) {
  process.stderr.write(`=== run ${i}/${RUNS} ===\n`);
  const out = execFileSync("node", ["--expose-gc", "benchmark.mjs"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  runs.push(extractJson(out));
}

const merged = mergeMedian(runs);
merged.aggregatedFrom = RUNS;
merged.aggregation = "median";
writeFileSync(OUT, JSON.stringify(merged, null, 2));

console.log(`\nMedian of ${RUNS} runs — throughput (r/s):`);
Object.entries(merged.throughput)
  .sort((a, b) => b[1] - a[1])
  .forEach(([lib, rps], i) => {
    console.log(`  ${i + 1}. ${lib.padEnd(30)} ${rps}`);
  });
console.log(`\nWrote ${OUT}`);

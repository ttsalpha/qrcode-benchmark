# qrcode-benchmark

Node.js benchmark comparing `@ttsalpha/qrcode`, `qrcode.react`, `qr-code-styling`, `react-qr-code`, and `qrcode` (headless baseline — no React component, compared via its async `toString('svg')`; React-only tests show `—`).

## Run

```bash
pnpm run bench
# or
node --expose-gc benchmark.mjs
```

Without `--expose-gc` the memory stability test is skipped (everything else still runs).

## Tests

| #   | Test             | What it measures                                                       |
| --- | ---------------- | ---------------------------------------------------------------------- |
| 1   | Throughput       | r/s over 3 s, unique input per render                                  |
| 2   | Data complexity  | median / p95 / p99 per input type (500 samples, unique input)          |
| 3   | Memory stability | heap drift over 5,000 unique renders                                   |
| 4   | Styled QR        | custom dot + corner shapes, ECL=H, size=512, unique input              |
| 5   | SSR simulation   | 12 real-world payloads × 10 rounds, unique per render                  |
| 6   | Sequential batch | burst of 100 renders (20 for qr-code-styling), unique per render       |
| 7   | True cold start  | `child_process.fork` — fresh process per round, import + render timing |
| 8   | Repeated value   | same input every render — quantifies value-level caching (see below)   |

## Design decisions

- **ECL pinned to M**, so a lib that silently upgrades the level does not look slower than it is. Test 4 runs at H, the level a styled QR with a logo needs; no logo is drawn, because `qr-code-styling` loads one through an `Image` that never resolves under JSDOM.
- **Unique input per render** in tests 1–7, so no lib is measured through its own cache: `@ttsalpha/qrcode` ≥2.4 memoizes matrices in a 16-entry LRU. Suffixes are fixed-length digits, so the encoding mode and QR version stay put.
- **Repeated value measured separately** in test 8, where re-rendering one QR is the real scenario and the cache is meant to dominate.
- **`child_process.fork` for cold start** — each round is a fresh process. Renders inside a round use unique values, so render #2 shows what a second request costs rather than a cache hit.
- **Warm-up is bounded by work, not by a count** — up to 2,000 iterations or 500 ms per lib. A heavy render path takes on the order of a thousand iterations before V8 optimises it, and measuring before that reports up to 2.4× its steady state.
- **The lib order rotates between runs** — `bench-median.mjs` gives each run a different `BENCH_ROTATE` offset, so no lib is always first or always last. Results keep their declared order.
- **`renderToString`** for the React libs, to stand in for SSR.
- **`@ttsalpha/qrcode/core` in the cold-start test**, since test 7 times the import and a headless caller has no reason to load React. The other tests use the root entry and do not time imports.
- **JSDOM polyfill** for `qr-code-styling`, which is browser-only.
- **The feature matrix is capability, not measurement** — `features` / `featureScores` come from each lib's API and docs, not from the tests. Capabilities the tests cannot reach, React Native among them, are left out rather than scored.

## Files

```
benchmark.mjs            # main runner
benchmark-coldstart.mjs  # fork worker for cold start test
```

## Results

Latest results: [GitHub Actions](https://github.com/ttsalpha/qrcode-benchmark/actions) — each run uploads a `result-<os>-node<version>.txt` artifact.

Published at: https://qrcode.ttsalpha.com/benchmark

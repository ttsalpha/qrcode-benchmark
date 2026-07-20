# qrcode-benchmark

Node.js benchmark comparing `@ttsalpha/qrcode`, `qrcode.react`, `qr-code-styling`, `react-qr-code`, and `qrcode` (headless baseline — no React component, compared via its async `toString('svg')`; React-only tests show `—`).

## Run

```bash
pnpm run bench
# or
node --expose-gc benchmark.mjs
```

`--expose-gc` is required — the process exits immediately without it.

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

- **ECL pinned to M** for all tests (styled QR uses H — logo-safe). Prevents libs with auto ECL-upgrading from appearing slower than they are.
- **Unique input per render** in every cold-path test (1–7) — no lib can benefit from internal caching. `@ttsalpha/qrcode` ≥2.4 memoizes matrices in a 16-entry LRU, so any test that repeats a value (or cycles fewer than 16 distinct values) would measure its cache instead of its pipeline. Suffixes are fixed-length digits so the encoding mode and QR version stay stable.
- **Repeated value measured separately** (test 8, clearly labeled) — re-rendering the same QR across requests is a real production scenario, and the cache is expected to dominate there by design.
- **`child_process.fork` for cold start** — each round is a fresh Node process with zero JIT warmup. Renders within a round also use unique values so render #2+ measures the JIT-warmed pipeline, not a cache hit.
- **`renderToString`** used for React-based libs to simulate SSR.
- **JSDOM polyfill** for `qr-code-styling` (browser-only lib).

## Files

```
benchmark.mjs            # main runner
benchmark-coldstart.mjs  # fork worker for cold start test
```

## Results

Latest: `results.txt` — Node.js v24.15.0, June 2026.

Published at: https://qrcode.ttsalpha.com/benchmark

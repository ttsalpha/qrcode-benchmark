# qrcode-benchmark

Node.js benchmark comparing `@ttsalpha/qrcode`, `qrcode.react`, `qr-code-styling`, and `react-qr-code`.

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
| 2   | Data complexity  | median / p95 / p99 per input type (500 samples)                        |
| 3   | Memory stability | heap drift over 5,000 unique renders                                   |
| 4   | Styled QR        | custom dot + corner shapes, ECL=H, size=512                            |
| 5   | SSR simulation   | 12 real-world payloads × 10 rounds                                     |
| 6   | Sequential batch | burst of 100 renders (20 for qr-code-styling)                          |
| 7   | True cold start  | `child_process.fork` — fresh process per round, import + render timing |

## Design decisions

- **ECL pinned to M** for all tests (styled QR uses H — logo-safe). Prevents libs with auto ECL-upgrading from appearing slower than they are.
- **Unique input per render** in throughput and memory tests — no lib can benefit from internal caching.
- **`child_process.fork` for cold start** — each round is a fresh Node process with zero JIT warmup. Previous in-process cold start measurements were invalid.
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

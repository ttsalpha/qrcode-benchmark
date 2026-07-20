/**
 * benchmark-coldstart.mjs — cold start worker
 * Spawned as a child process by benchmark.mjs.
 * Imports ONE library, renders N times (no warmup), reports timings via IPC.
 *
 * Env vars:
 *   COLD_LIB    — which lib to test (ttsalpha-util | ttsalpha-react | qrcode.react | react-qr-code | qr-code-styling)
 *   COLD_ECL    — error correction level (default 'M')
 *   COLD_ROUNDS — number of renders to measure (default 5)
 */

const LIB = process.env.COLD_LIB;
const ECL = process.env.COLD_ECL || "M";
const ROUNDS = parseInt(process.env.COLD_ROUNDS || "5", 10);
// A per-render suffix is appended so render #2+ measures the JIT-warmed
// pipeline, not a value-level cache hit (@ttsalpha/qrcode ≥2.4 has an LRU).
const VALUE = "https://example.com/cold-start-test";

async function run() {
  if (LIB === "qr-code-styling") {
    const { JSDOM } = await import("jsdom");
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
  }

  const t_import_start = performance.now();
  let importMs = 0;
  let renderFn;

  if (LIB === "ttsalpha-util") {
    const { toSVGString } = await import("@ttsalpha/qrcode");
    importMs = performance.now() - t_import_start;
    renderFn = (i) => toSVGString({ value: `${VALUE}/${i}`, errorCorrectionLevel: ECL, size: 256 });
  } else if (LIB === "ttsalpha-react") {
    const { renderToString } = await import("react-dom/server");
    const React = (await import("react")).default;
    const { QRCode } = await import("@ttsalpha/qrcode");
    importMs = performance.now() - t_import_start;
    renderFn = (i) =>
      renderToString(
        React.createElement(QRCode, {
          value: `${VALUE}/${i}`,
          errorCorrectionLevel: ECL,
          size: 256,
        }),
      );
  } else if (LIB === "qrcode.react") {
    const { renderToString } = await import("react-dom/server");
    const React = (await import("react")).default;
    const { QRCodeSVG } = await import("qrcode.react");
    importMs = performance.now() - t_import_start;
    renderFn = (i) =>
      renderToString(
        React.createElement(QRCodeSVG, { value: `${VALUE}/${i}`, level: ECL, size: 256 }),
      );
  } else if (LIB === "react-qr-code") {
    const { renderToString } = await import("react-dom/server");
    const React = (await import("react")).default;
    const { default: ReactQRCode } = await import("react-qr-code");
    importMs = performance.now() - t_import_start;
    renderFn = (i) =>
      renderToString(
        React.createElement(ReactQRCode, { value: `${VALUE}/${i}`, level: ECL, size: 256 }),
      );
  } else if (LIB === "qr-code-styling") {
    const { default: QRCodeStyling } = await import("qr-code-styling");
    importMs = performance.now() - t_import_start;
    renderFn = async (i) => {
      const q = new QRCodeStyling({
        data: `${VALUE}/${i}`,
        type: "svg",
        width: 256,
        height: 256,
        qrOptions: { errorCorrectionLevel: ECL },
      });
      await q.getRawData("svg");
    };
  } else {
    process.send({ lib: LIB, error: `Unknown lib: ${LIB}` });
    process.exit(1);
  }

  // Measure N renders — no warmup intentionally
  const renders = [];
  for (let i = 0; i < ROUNDS; i++) {
    const t = performance.now();
    await renderFn(i);
    renders.push(Number((performance.now() - t).toFixed(3)));
  }

  const result = { lib: LIB, importMs: Number(importMs.toFixed(2)), renders };
  if (process.send) {
    process.send(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

run().catch((err) => {
  const result = { lib: LIB, error: err.message };
  if (process.send) {
    process.send(result);
    process.exit(1);
  } else {
    console.error(JSON.stringify(result));
    process.exit(1);
  }
});

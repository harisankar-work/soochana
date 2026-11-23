// Optional QA transport for cloud Chromium with a different certificate store.
// This module is never imported by the application or the direct cold-start check.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const models = {
  "twitter-roberta-base-sentiment-latest": {
    revision: "f3ec4d0925f90c3ca7ee7814f52d6ee7cf180445",
    hash: "046f7e4cc46b399558fa9b2de966f6b0d42c69e4b01f582bfb4099b01a0bb5d7",
  },
  "all-MiniLM-L6-v2": {
    revision: "751bff37182d3f1213fa05d7196b954e230abad9",
    hash: "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
  },
};

export async function stageModelAssets(context) {
  const directory = await mkdtemp(join(tmpdir(), "soochana-model-qa-"));
  const assets = new Map();
  const server = createServer(async (request, response) => {
    const asset = assets.get(request.url);
    if (!asset || !["GET", "HEAD"].includes(request.method)) return response.writeHead(404).end();
    try {
      const { path, contentType, size } = await asset;
      const headers = { "content-type": contentType, "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" };
      const range = request.headers.range === "bytes=0-0";
      response.writeHead(range ? 206 : 200, { ...headers, "content-length": range ? 1 : size, ...(range ? { "content-range": `bytes 0-0/${size}` } : {}) });
      if (request.method === "HEAD") response.end();
      else createReadStream(path, range ? { start: 0, end: 0 } : {}).pipe(response);
    } catch {
      response.writeHead(502).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const routes = /^https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//;
  await context.route(routes, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const modelPath = /^\/Xenova\/([^/]+)\/resolve\/([^/]+)\/(config\.json|tokenizer\.json|tokenizer_config\.json|onnx\/model_quantized\.onnx)$/.exec(url.pathname);
    const model = modelPath && Object.hasOwn(models, modelPath[1]) ? models[modelPath[1]] : null;
    const runtime = url.hostname === "cdn.jsdelivr.net" && /^\/npm\/onnxruntime-web@1\.31\.0-dev\.20260914-8d85527a0\/dist\/ort-wasm-simd-threaded\.asyncify\.(mjs|wasm)$/.test(url.pathname);
    if (url.search || request.postData() || !["GET", "HEAD"].includes(request.method()) ||
      !(runtime || (url.hostname === "huggingface.co" && model && model.revision === modelPath[2]))) {
      await route.abort();
      return;
    }
    const key = "/" + createHash("sha256").update(url.href).digest("hex");
    if (!assets.has(key)) {
      const load = (async () => {
        const path = join(directory, key.slice(1));
        await execute("curl", ["--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https", "--max-time", "180", "--output", path, url.href]);
        if (url.pathname.endsWith(".onnx")) {
          const digest = createHash("sha256");
          for await (const bytes of createReadStream(path)) digest.update(bytes);
          if (digest.digest("hex") !== model.hash) throw new Error("Unexpected model SHA-256");
        }
        const contentType = url.pathname.endsWith(".json") ? "application/json" :
          url.pathname.endsWith(".mjs") ? "text/javascript" :
          url.pathname.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
        return { path, contentType, size: (await stat(path)).size };
      })();
      assets.set(key, load);
    }
    try {
      await assets.get(key);
      await route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:${server.address().port}${key}`, "access-control-allow-origin": "*" } });
    } catch {
      await route.abort();
    }
  });
  return { origin: `http://127.0.0.1:${server.address().port}`, close: async () => {
    await context.unroute(routes).catch(() => {});
    await Promise.allSettled(assets.values());
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  } };
}

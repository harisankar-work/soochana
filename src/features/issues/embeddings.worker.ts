import { env, pipeline } from "@huggingface/transformers";
import { MODEL_ID, MODEL_REVISION, DIMENSIONS, validEmbedding, type Event, type Request } from "./protocol";

env.allowLocalModels = false;
env.remotePathTemplate = `{model}/resolve/${MODEL_REVISION}/`;
env.useBrowserCache = typeof caches !== "undefined";
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
}

const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<Request>) => void;
  postMessage(event: Event, transfer?: Transferable[]): void;
};

worker.onmessage = async ({ data: { run, records } }) => {
  const send = (event: Event) => worker.postMessage(event);
  try {
    send({ run, type: "download" });
    const embed = await pipeline("feature-extraction", MODEL_ID, {
      device: "wasm", dtype: "q8", revision: MODEL_REVISION,
      progress_callback(event) {
        if (!("file" in event) || !event.file.endsWith(".onnx")) return;
        if (event.status === "progress" && Number.isFinite(event.progress) && event.total > 0) {
          send({ run, type: "download", progress: Math.max(0, Math.min(100, event.progress)) });
        }
        if (event.status === "done") send({ run, type: "initialize" });
      },
    });
    send({ run, type: "embed" });
    for (const { id, text } of records) {
      try {
        const output = await embed(text, { pooling: "mean", normalize: true });
        if (output.dims.length !== 2 || output.dims[0] !== 1 || output.dims[1] !== DIMENSIONS || !validEmbedding(output.data)) {
          throw new Error("Invalid vector");
        }
        const vector = new Float32Array(output.data);
        worker.postMessage({ run, type: "result", id, vector }, [vector.buffer]);
      } catch {
        send({ run, type: "row-error", id });
      }
    }
    send({ run, type: "done" });
  } catch {
    send({ run, type: "error" });
  }
};

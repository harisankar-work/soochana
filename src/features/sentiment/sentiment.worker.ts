import { AutoModelForSequenceClassification, AutoTokenizer, env, softmax } from "@huggingface/transformers";
import { MODEL_ID, MODEL_REVISION, type WorkerEvent, type WorkerRequest } from "./protocol";

// The checkpoint has 514 position embeddings and RoBERTa reserves two positions.
const MAX_TOKENS = 512;

env.allowLocalModels = false;
// Keep the tokenizer's metadata preflight on the pinned revision too.
env.remotePathTemplate = `{model}/resolve/${MODEL_REVISION}/`;
env.useBrowserCache = typeof caches !== "undefined";
const wasm = env.backends.onnx.wasm;
if (wasm) {
  wasm.numThreads = 1;
  wasm.proxy = false;
}

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(event: WorkerEvent): void;
};
type Model = Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>>;
type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
let classifier: { model: Model; tokenizer: Tokenizer; names: Record<number, string> } | undefined;
let running = false;

worker.onmessage = async ({ data: { run, records } }) => {
  if (running) return;
  running = true;
  const send = (event: WorkerEvent) => worker.postMessage(event);
  try {
    if (!classifier) {
      send({ run, type: "download" });
      const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { revision: MODEL_REVISION });
      const model = await AutoModelForSequenceClassification.from_pretrained(MODEL_ID, {
        device: "wasm",
        dtype: "q8",
        revision: MODEL_REVISION,
        progress_callback(event) {
          if (!("file" in event) || !event.file.endsWith(".onnx")) return;
          if (event.status === "progress" && Number.isFinite(event.progress) && event.total > 0) {
            send({ run, type: "download", progress: Math.min(100, Math.max(0, event.progress)) });
          }
          if (event.status === "done") send({ run, type: "initialize" });
        },
      });
      const names = (model.config as { id2label?: Record<number, string> }).id2label;
      if (names?.[0] !== "negative" || names?.[1] !== "neutral" || names?.[2] !== "positive") {
        throw new Error("Unexpected model labels.");
      }
      classifier = { tokenizer, model, names };
    }
    send({ run, type: "analyse" });
    const { model, tokenizer, names } = classifier;
    for (const { id, text } of records) {
      try {
        const input = tokenizer(text, { truncation: true, max_length: MAX_TOKENS });
        const { logits } = await model(input);
        const scores = Array.from(softmax(logits.data as Float32Array), (score, index) => ({ label: names[index], score }));
        send({ run, type: "result", id, scores });
      } catch {
        send({ run, type: "row-error", id });
      }
    }
    send({ run, type: "done" });
  } catch {
    send({ run, type: "error", message: "The model could not start. Check your internet connection and available memory, then retry in a browser with WebAssembly support." });
  } finally {
    running = false;
  }
};

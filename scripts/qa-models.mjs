import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { stageModelAssets } from "./qa-model-assets.mjs";

const browser = await chromium.launch({ executablePath: (process.env.SOOCHANA_CHROMIUM ?? process.env.VOICELOOP_CHROMIUM) });
const origin = new URL((process.env.SOOCHANA_URL ?? process.env.VOICELOOP_URL) ?? "http://localhost:3000").origin;
let staged;
try {
  const page = await browser.newPage();
  staged = await stageModelAssets(page.context());
  await page.addInitScript(() => {
    window.qaModelEvents = [];
    const WorkerConstructor = window.Worker;
    window.Worker = class extends WorkerConstructor {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          window.qaModelEvents.push({ type: data.type, time: performance.now() });
        });
      }
    };
  });
  const errors = [], unauthorized = [];
  const reviewPrefix = "Synthetic delivery test";
  let modelRequests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.context().on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "blob:") return;
    const asset = url.hostname === "huggingface.co" && url.pathname.startsWith("/Xenova/");
    const runtime = url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/onnxruntime-web@");
    if (asset) modelRequests++;
    if (!(url.origin === origin || url.origin === staged.origin || asset || runtime) ||
      !["GET","HEAD"].includes(request.method()) || request.postData() || url.href.includes(encodeURIComponent(reviewPrefix))) unauthorized.push(url.hostname);
  });
  const measurements=[];
  for (const model of ["sentiment","embeddings"]) {
    for (const [state, count] of [["staged cold",10],["warm cache",100]]) {
      await page.goto(origin + "/feedback");
      const button = (name) => page.getByRole("button",{name,exact:true});
      const csv = "review\n" + Array.from({length:count},(_,i)=>`${reviewPrefix} ${i}: ${i%2 ? "The driver was late again." : "Checkout was fast today."}`).join("\n");
      await page.locator("input[type=file]").setInputFiles({name:"synthetic.csv",mimeType:"text/csv",buffer:Buffer.from(csv)});
      for (const label of ["Review quality", "Preview accepted records", "Continue to confirmation", `Import ${count} feedback records`]) await button(label).click();
      if (model === "embeddings") await page.getByRole("navigation").getByRole("link",{name:"Issue Explorer"}).click();
      const before = modelRequests;
      const start = performance.now();
      await button(model === "sentiment" ? "Analyse Sentiment" : "Discover Feedback Groups").click();
      await page.getByText(model === "sentiment" ? "Analysis completed" : "Embedding run finished",{exact:true}).waitFor({timeout:120000});
      const totalMs = performance.now() - start;
      const events = await page.evaluate(()=>window.qaModelEvents);
      const analysis = events.find(({type})=>type==="analyse"||type==="embed");
      const download = events.find(({type})=>type==="download");
      const initialized = events.find(({type})=>type==="initialize");
      const done = events.find(({type})=>type==="done");
      const valid = events.filter(({type})=>type==="result").length;
      assert.equal(valid,count);
      if (state === "warm cache") assert.equal(modelRequests,before);
      measurements.push({model,state,count,totalMs,inferenceMs:done.time-analysis.time,loadPlusInitMs:analysis.time-download.time,
        initializationAfterWeightMs:initialized ? analysis.time-initialized.time : null,modelRequests:modelRequests-before});
    }
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(unauthorized,[]);
  console.log(JSON.stringify(measurements,null,2));
} finally {
  await browser.close();
  await staged?.close();
}

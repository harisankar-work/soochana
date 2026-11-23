import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [baselineFile, candidateFile, baselineReuseFile, candidateReuseFile, batchExperimentFile] = process.argv.slice(2);
assert.ok(baselineFile && candidateFile && baselineReuseFile && candidateReuseFile,
  "Provide baseline, candidate, baseline reuse, and candidate reuse JSON reports.");
const [baseline, candidate, baselineReuse, candidateReuse] = await Promise.all(
  [baselineFile, candidateFile, baselineReuseFile, candidateReuseFile].map(async (file) => JSON.parse(await readFile(file, "utf8"))),
);
assert.equal(baseline.browser, candidate.browser);
assert.equal(baseline.cpu, candidate.cpu);
assert.equal(baseline.backend, candidate.backend);
assert.deepEqual(baseline.revisions, candidate.revisions);
const batchExperiment = batchExperimentFile ? JSON.parse(await readFile(batchExperimentFile)) : null;
const ms = (value) => Math.round(value).toLocaleString("en-US");
const fixed = (value) => value.toFixed(3);
const pairedRuns = baseline.runs.map((first) => {
  const second = candidate.runs.find((run) => run.model === first.model && run.dataset === first.dataset);
  assert.ok(second);
  assert.equal(second.accepted, first.accepted);
  assert.equal(second.rejected, first.rejected);
  assert.equal(second.cache, first.cache);
  if (first.model === "sentiment") {
    assert.deepEqual(second.quality.confusionMatrix, first.quality.confusionMatrix);
    assert.deepEqual(second.quality.predictions.map(({ actual }) => actual), first.quality.predictions.map(({ actual }) => actual));
  } else {
    assert.ok(second.quality.maxCosineDrift < 1e-6, "Single-review embeddings should preserve similarity");
    assert.deepEqual(second.quality.configurations.map(({ groups }) => groups), first.quality.configurations.map(({ groups }) => groups));
  }
  return [first, second];
});
const timingRows = pairedRuns.map(([a, b]) => `| ${a.model} | ${a.dataset} | ${a.cache} | ${ms(a.totalMs)} → ${ms(b.totalMs)} | ${ms(a.loadInitMs)} → ${ms(b.loadInitMs)} | ${ms(a.inferenceMs)} → ${ms(b.inferenceMs)} |`);
const sentimentRows = pairedRuns.filter(([a]) => a.model === "sentiment")
  .map(([a, b]) => `| ${a.dataset} | ${fixed(a.quality.accuracy)} → ${fixed(b.quality.accuracy)} | ${fixed(a.quality.macroF1)} → ${fixed(b.quality.macroF1)} | ${a.quality.errors.length} → ${b.quality.errors.length} |`);
const embeddingRows = pairedRuns.filter(([a]) => a.model === "embeddings").flatMap(([a, b]) => a.quality.configurations.map((first, index) => {
  const second = b.quality.configurations[index];
  assert.equal(first.method, second.method);
  assert.equal(first.cutoff, second.cutoff);
  return `| ${a.dataset} | ${first.method} / ${first.cutoff} | ${fixed(first.f1)} → ${fixed(second.f1)} | ${first.falseMerges.length} → ${second.falseMerges.length} | ${first.falseSplits.length} → ${second.falseSplits.length} | ${first.ungrouped.length} → ${second.ungrouped.length} |`;
}));
const reuseRows = baselineReuse.runs[0].sameDatasetReruns.map((first, i) => {
  const second = candidateReuse.runs[0].sameDatasetReruns[i];
  assert.equal(first.count, second.count);
  assert.equal(second.freshEmbeddings, 0);
  return `| ${first.count} | ${ms(first.elapsedMs)} → ${ms(second.elapsedMs)} | ${first.freshEmbeddings} → ${second.freshEmbeddings} |`;
});
const batchRows = batchExperiment?.runs.filter(({ model }) => model === "embeddings").map((run) => {
  const original = baseline.runs.find((before) => before.model === run.model && before.dataset === run.dataset);
  const before = original.quality.configurations[1], after = run.quality.configurations[1];
  return `| ${run.dataset} | ${ms(original.inferenceMs)} → ${ms(run.inferenceMs)} | ${fixed(before.f1)} → ${fixed(after.f1)} | ${before.falseMerges.length} → ${after.falseMerges.length} | ${before.falseSplits.length} → ${after.falseSplits.length} | ${fixed(run.quality.maxCosineDrift)} |`;
});
const batchNote = batchRows ? `
## Why batching was rejected

An intermediate candidate inferred up to four similar-length reviews per WASM call. It changed model output enough to alter average-link memberships and increased errors in the 100-review fixture. It was also slower on that fixture in this run. The final candidate uses one review per inference, retains the loaded model for an eligible next run and reuses validated embeddings from the current dataset. No thresholds were adjusted.

| Fixture | Inference milliseconds | Average-link F1 | False merges | False splits | Max cosine drift |
| --- | ---: | ---: | ---: | ---: | ---: |
${batchRows.join("\n")}
` : "";
console.log(`# Segmentation performance and quality

Baseline \`${baseline.revision}\` and candidate \`${candidate.revision}\` ran as production builds on ${candidate.os}, ${candidate.cpu}, Chromium ${candidate.browser}, Node ${candidate.node}, Transformers.js ${candidate.transformers}, and ONNX Runtime Web ${candidate.runtime}. Both runs used single-threaded WASM q8 inference with the same pinned model revisions. Both used the same labeled datasets and fixed configurations. Meanings and topic assignments were frozen before inference. These labels are author-assigned synthetic references with no independent human validation.

Each model used one fresh browser context for the cold run. Subsequent cases used the same artifact cache and a fresh worker after page navigation. Each cell is a single measurement on a shared host. The difference in unchanged sentiment timings illustrates run-to-run variability. The reuse experiment also counts actual model outputs, which directly verifies the avoided computation. Cold timing includes HTTPS delivery and varies with network performance. Chromium used the environment-provided CA certificates with TLS validation enabled. Peak memory was unavailable. The time includes click handling through the rendered completion message. Inference and initialization use real worker events.

## Time in milliseconds

| Model | Fixture | Cache state | Total | Load and initialize | Inference |
| --- | --- | --- | ---: | ---: | ---: |
${timingRows.join("\n")}

## Sentiment

| Fixture | Accuracy | Macro F1 | Disagreements |
| --- | ---: | ---: | ---: |
${sentimentRows.join("\n")}

## Clustering

| Fixture | Method and cutoff | Pairwise F1 | False merges | False splits | Ungrouped |
| --- | --- | ---: | ---: | ---: | ---: |
${embeddingRows.join("\n")}

Largest measured absolute cosine change across compared pairs was ${Math.max(...candidate.runs.filter((run) => run.model === "embeddings").map((run) => run.quality.maxCosineDrift ?? 0)).toExponential(3)}. The historical development and holdout files and their thresholds were preserved.

## Repeat discovery in the same dataset

Each column follows an initial complete 100-review run. The scope changes without replacing the imported dataset. Times include the browser interaction and visible result update.

| Requested | Total milliseconds | Fresh model outputs |
| ---: | ---: | ---: |
${reuseRows.join("\n")}

${batchNote}
The JSON reports include stage timings, complete sentiment predictions, confusion matrices, cluster memberships, per-pair similarity scores, and browser metadata. The deterministic import suite separately verifies all accepted and rejected rows and dashboard aggregates. [Baseline JSON](m10-segmentation-baseline.json) · [Candidate JSON](m10-segmentation-candidate.json) · [Batch experiment](m10-segmentation-batching-experiment.json) · [Baseline reuse](m10-reuse-baseline.json) · [Candidate reuse](m10-reuse-final.json) · [Deterministic import](m10-deterministic-import.json) · [Reproduction commands](../../README.md#milestone-10-evaluation)`);

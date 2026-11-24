# Segmentation performance and quality

Baseline `0529b059e5e5755a7ba9cb9b9b79644856d0ed4e` and candidate `0529b05 + Milestone 10 candidate` ran as production builds on linux 6.18.57, AMD EPYC 9V74 80-Core Processor, Chromium 156.0.8078.79, Node v24.22.3, Transformers.js 4.3.2, and ONNX Runtime Web 1.31.0-dev.20260914-8d85527a0. Both runs used single-threaded WASM q8 inference with the same pinned model revisions. Both used the same labeled datasets and fixed configurations. Meanings and topic assignments were frozen before inference. These labels are author-assigned synthetic references with no independent human validation.

Each model used one fresh browser context for the cold run. Subsequent cases used the same artifact cache and a fresh worker after page navigation. Each cell is a single measurement on a shared host. The difference in unchanged sentiment timings illustrates run-to-run variability. The reuse experiment also counts actual model outputs, which directly verifies the avoided computation. Cold timing includes HTTPS delivery and varies with network performance. Chromium used the environment-provided CA certificates with TLS validation enabled. Peak memory was unavailable. The time includes click handling through the rendered completion message. Inference and initialization use real worker events.

## Time in milliseconds

| Model | Fixture | Cache state | Total | Load and initialize | Inference |
| --- | --- | --- | ---: | ---: | ---: |
| sentiment | tiny-10 | cold fresh context | 17,853 → 17,664 | 15,829 → 15,474 | 1,638 → 1,628 |
| sentiment | small-25 | warm artifacts, fresh worker | 9,736 → 8,645 | 4,870 → 3,742 | 4,450 → 4,322 |
| sentiment | medium-50 | warm artifacts, fresh worker | 12,939 → 7,516 | 2,622 → 2,177 | 10,023 → 4,715 |
| sentiment | benchmark-100 | warm artifacts, fresh worker | 16,899 → 11,068 | 2,933 → 2,642 | 13,539 → 7,832 |
| embeddings | tiny-10 | cold fresh context | 11,370 → 6,771 | 9,076 → 5,817 | 1,699 → 343 |
| embeddings | small-25 | warm artifacts, fresh worker | 5,635 → 2,567 | 3,527 → 1,226 | 1,692 → 939 |
| embeddings | medium-50 | warm artifacts, fresh worker | 6,862 → 3,856 | 2,360 → 1,593 | 3,679 → 1,829 |
| embeddings | benchmark-100 | warm artifacts, fresh worker | 6,523 → 5,183 | 2,194 → 1,557 | 3,745 → 2,752 |

## Sentiment

| Fixture | Accuracy | Macro F1 | Disagreements |
| --- | ---: | ---: | ---: |
| tiny-10 | 0.500 → 0.500 | 0.400 → 0.400 | 5 → 5 |
| small-25 | 0.600 → 0.600 | 0.576 → 0.576 | 10 → 10 |
| medium-50 | 0.600 → 0.600 | 0.552 → 0.552 | 20 → 20 |
| benchmark-100 | 0.620 → 0.620 | 0.603 → 0.603 | 38 → 38 |

## Clustering

| Fixture | Method and cutoff | Pairwise F1 | False merges | False splits | Ungrouped |
| --- | --- | ---: | ---: | ---: | ---: |
| tiny-10 | complete-link-v1 / 0.75 | 0.000 → 0.000 | 0 → 0 | 0 → 0 | 10 → 10 |
| tiny-10 | average-link-v1 / 0.45 | 0.000 → 0.000 | 1 → 1 | 0 → 0 | 8 → 8 |
| small-25 | complete-link-v1 / 0.75 | 0.000 → 0.000 | 0 → 0 | 7 → 7 | 25 → 25 |
| small-25 | average-link-v1 / 0.45 | 0.267 → 0.267 | 6 → 6 | 5 → 5 | 15 → 15 |
| medium-50 | complete-link-v1 / 0.75 | 0.000 → 0.000 | 1 → 1 | 20 → 20 | 48 → 48 |
| medium-50 | average-link-v1 / 0.45 | 0.270 → 0.270 | 12 → 12 | 15 → 15 | 22 → 22 |
| benchmark-100 | complete-link-v1 / 0.75 | 0.000 → 0.000 | 2 → 2 | 115 → 115 | 96 → 96 |
| benchmark-100 | average-link-v1 / 0.45 | 0.323 → 0.323 | 41 → 41 | 85 → 85 | 34 → 34 |

Largest measured absolute cosine change across compared pairs was 0.000e+0. The historical development and holdout files and their thresholds were preserved.

## Repeat discovery in the same dataset

Each column follows an initial complete 100-review run. The scope changes without replacing the imported dataset. Times include the browser interaction and visible result update.

| Requested | Total milliseconds | Fresh model outputs |
| ---: | ---: | ---: |
| 25 | 2,921 → 57 | 25 → 0 |
| 50 | 3,940 → 51 | 50 → 0 |
| 100 | 6,582 → 52 | 100 → 0 |
| 100 | 8,851 → 59 | 100 → 0 |


## Why batching was rejected

An intermediate candidate inferred up to four similar-length reviews per WASM call. It changed model output enough to alter average-link memberships and increased errors in the 100-review fixture. It was also slower on that fixture in this run. The final candidate uses one review per inference, retains the loaded model for an eligible next run and reuses validated embeddings from the current dataset. No thresholds were adjusted.

| Fixture | Inference milliseconds | Average-link F1 | False merges | False splits | Max cosine drift |
| --- | ---: | ---: | ---: | ---: | ---: |
| tiny-10 | 1,699 → 725 | 0.000 → 0.000 | 1 → 2 | 0 → 0 | 0.032 |
| small-25 | 1,692 → 1,871 | 0.267 → 0.250 | 6 → 7 | 5 → 5 | 0.042 |
| medium-50 | 3,679 → 1,455 | 0.270 → 0.270 | 12 → 12 | 15 → 15 | 0.042 |
| benchmark-100 | 3,745 → 4,947 | 0.323 → 0.309 | 41 → 44 | 85 → 86 | 0.054 |

The JSON reports include stage timings, complete sentiment predictions, confusion matrices, cluster memberships, per-pair similarity scores, and browser metadata. The deterministic import suite separately verifies all accepted and rejected rows and dashboard aggregates. [Baseline JSON](m10-segmentation-baseline.json) · [Candidate JSON](m10-segmentation-candidate.json) · [Batch experiment](m10-segmentation-batching-experiment.json) · [Baseline reuse](m10-reuse-baseline.json) · [Candidate reuse](m10-reuse-final.json) · [Deterministic import](m10-deterministic-import.json) · [Reproduction commands](../../README.md#milestone-10-evaluation)

# Milestone 11 grouping evaluation

Real Chromium inference used the pinned q8 MiniLM WASM worker and the existing browser import flow. The software preserved the 100-record cap, one review per model call, session-scoped validated embeddings, and the frozen development and holdout datasets. Topic annotations are author-assigned references and have no independent human adjudication.

The initial comparison evaluated complete-link, average-link, centroid-link, and mutual-nearest grouping on development. Average-link at .45 had the best development F1 of .574 and precision of .571, below the predeclared .80 precision floor. The new hybrid blended MiniLM cosine with unique lowercase Unicode token overlap. Its formula was `0.85 × cosine + 0.15 × Dice`, using tokens of at least four characters. A development sweep selected average-link at .40 for one diagnostic holdout run. This hybrid achieved development F1 .567 and precision .587. No hybrid configuration met the .80 floor. Neither candidate was selected on holdout results.

| Fixture | Configuration | Precision | Recall | Pairwise F1 | False merges | False splits | Grouped / total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Original 48 | Complete-link .75 | .667 | .019 | .037 | 1 | 103 | 6 / 48 |
| Original 48 | Average-link .45 | .677 | .619 | .647 | 31 | 40 | 41 / 48 |
| Frozen holdout 46 | Complete-link .75 | .000 | .000 | .000 | 0 | 54 | 0 / 46 |
| Frozen holdout 46 | Average-link .45 | .431 | .463 | .446 | 33 | 29 | 35 / 46 |
| Frozen holdout 46 | Hybrid average-link .40 | .465 | .370 | .412 | 23 | 34 | 34 / 46 |

The holdout hybrid reduced false merges by ten and increased false splits by five. It fell below both the precision floor and the exploratory baseline F1. Neither the model nor the clustering default changed. Complete-link .75 can produce no recurring groups. The workflow offers a deliberate switch to average-link .45 for broader suggestions and supports manually organizing any review. Review suggestions before treating them as product problems.

The holdout runs completed through embeddings in 7.13 and 6.88 seconds in different fresh Chromium contexts. Those single cold observations include artifact delivery and cannot establish a model performance gain. Shared-host variability and native WASM memory were not isolated. New workflow timings are reported separately in the functional audit. Density-based and alternative-model experiments were not run. The existing mutual-nearest method covers a graph-based comparison. The historical category-free fixtures cannot isolate the effect of category-aware grouping without a new annotated comparison.

Reproduce against a production build with a Chromium trust store that validates HTTPS. Set `SOOCHANA_URL` and `SOOCHANA_CHROMIUM` for the local build.

```sh
npm run evaluate:issues -- baseline average-link-v1 .45
SOOCHANA_LEXICAL_WEIGHT=.15 npm run evaluate:issues -- development
npm run evaluate:issues -- holdout average-link-v1 .45
SOOCHANA_LEXICAL_WEIGHT=.15 npm run evaluate:issues -- holdout average-link-v1 .40
```

[Machine-readable results](milestone-11-grouping.json) · [Historical methodology and development comparisons](../issues-4.1-report.md) · [Milestone 10 reproducibility](milestone-10-comparison.md)

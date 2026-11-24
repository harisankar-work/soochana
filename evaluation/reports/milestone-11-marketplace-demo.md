# Marketplace demo evaluation

The input contains 100 fictional reviews from one digital marketplace. Feedback IDs, dates, sources, ratings, product areas, platforms, and customer segments are in the CSV. The reference categories, labels, and worked scoring examples were authored separately and frozen before model capture. They are synthetic and have no independent human adjudication. The exact reference checks found 100 accepted rows, zero validation issues, a 2.18/5 average rating, and 25 reviews from each source.

Using Chromium 156 and the pinned quantized browser workers, preparation captured 100 genuine sentiment predictions and 100 valid MiniLM embeddings. The prepared artifact binds those outputs to the CSV SHA-256 and both model revisions. The app reconstructs clusters and ranks issues from these outputs using the normal code. It verifies the dataset digest, artifact shape, model revisions, predictions, and normalized vectors before replacing the workspace. No expected labels are sent to either worker or shipped in the prepared artifact.

| Analysis | Groups | Grouped | Unassigned | Potential issues | Pairwise precision | Recall | F1 | False merges | False splits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Complete-link .75 | 4 | 8 | 92 | 2 | 1.000 | .007 | .015 | 0 | 539 |
| Average-link .45 | 14 | 79 | 21 | 7 | .946 | .678 | .790 | 21 | 175 |

The strict run found few pairs because every pair in each group must meet .75. The exploratory .45 setting was previously selected on the separate development dataset and scored .446 F1 on the frozen holdout, compared with zero for strict complete-link. The stronger demo result is fixture-specific. It does not establish real-world precision or guarantee the target group counts. The lexical hybrid was previously rejected after lower holdout F1. Reviews still require human judgment.

The demo uses the exploratory method to introduce reviewable groups. Ordinary automatic import still tries strict discovery first. If the completed strict pass finds no groups and the broader pass finds some, the app presents them as explicitly flagged suggestions. That fallback does not rerun inference. Outside the synthetic demo, issues begin without business assessments. Demo illustrations attach only to actual groups with at least three matching-area records and 75% area agreement. They do not change cluster membership. Predicted sentiment on the fixture was 52 negative, 42 neutral, and 6 positive.

To recreate the asset, serve a production build locally and run Chromium with trusted HTTPS certificate validation. Set `SOOCHANA_URL` and `SOOCHANA_CHROMIUM` for the app and executable.

```sh
npm run prepare:marketplace
npm run evaluate:marketplace
npm run qa:marketplace
npm run qa:product
```

[Exact and semantic references](../ground-truth/marketplace-demo.json) · [Computed metrics](milestone-11-marketplace-demo.json) · [Independent grouping comparison](milestone-11-grouping.md) · [Archived 96-review demo](../datasets/historical-demo-96.csv)

## Local production-build verification

Chromium 156.0.8078.79 loaded the prepared workspace in 1.5 seconds without requesting model assets. The live rerun took 55.3 seconds and made 30 model-related requests with certificate validation enabled. Both modes produced the same sentiment and grouping counts. The prepared queue showed six scored and eight unscored groups. Card payments fail during checkout ranked first at 91.75 with illustrative assessments. The browser checks independently confirmed the score and verified that a title edit survived live analysis.

The product workflow passed cancellation and retry, editing and export checks, and responsive runs at 320, 390, 768, 1024, and 1440 pixels. Forty automated accessibility scans and four product-workflow scans reported zero violations. These results cover Chromium on the local production build. [Browser results](milestone-11-marketplace-browser.json) · [Desktop and mobile screenshots](../../docs/demo/screenshots/marketplace/)

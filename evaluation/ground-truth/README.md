# Reference expectations and provenance

## Deterministic reference

`loadDataset` in [the dataset harness](../../scripts/evaluate-datasets.mjs) emits CSV and a row-level reference. Exact reference outcomes originate in explicit fixture rules. The independent reference covers import disposition, duplicates, validation messages, source, ISO date and rating handling, row identifiers, filtering counts and projected Jira fields. The original demo is read using an independent field expression and validated against the application. Browser integration and [calculation regression tests](../../tests/evaluation-datasets.test.tsx) cover dashboard totals, sorting and independently calculated priority scoring. Model output is stored separately.

## Authored semantic reference

[The 100-review reference](authored-reviews.tsv) was assigned before inference by the fixture author, with no independent human annotation or adjudication. Treat it as a synthetic reference. The sentiment labels reflect the overall experience, including sarcasm or a dominant outcome in some mixed records. A topic represents the main actionable issue or described outcome. Rows with the same topic are positive clustering pairs. Different topics are negative pairs. Secondary intents and multiple valid groupings remain possible.

The first 10, 25 and 50 rows form fixed prefixes for limited evaluation and comparable warm performance, so their quality measurements are correlated. The prior development and holdout datasets retain their original roles and are outside this new corpus. No cutoff is tuned against the existing holdout or the new evaluation data.

The references cover e-commerce, fintech, food delivery, SaaS, mobile applications, and customer support. They intentionally include paraphrases, confusingly similar language, negation, sarcasm, mixed outcomes, Unicode, emoji and multilingual text. English-biased models may disagree with multilingual or ambiguous labels. None of these results provides a production accuracy estimate.

## Public sources reviewed on 23 November 2026

| Public source | Provenance and size | License and use |
| --- | --- | --- |
| [UCI Sentiment Labelled Sentences](https://archive.ics.uci.edu/dataset/331/sentiment+labelled+sentences) | Kotzias et al., KDD 2015. 3,000 selected sentences, 1,000 each from Amazon, IMDb and Yelp. Source labels distinguish positive from negative, with authors deliberately selecting clear examples and excluding neutral ones. | UCI lists CC BY 4.0. The official ZIP was downloaded on 23 November 2026 and pinned by SHA-256. An optional 24-row Amazon-only stratified sample preserves the labels and source row IDs. The generated CSV and references stay outside the repository. |
| [BANKING77](https://huggingface.co/datasets/PolyAI/banking77) | Casanueva et al. 2020. The dataset card describes 13,083 English online banking queries in 77 annotated intents. | The card and upstream repository identify CC BY 4.0. Dataset metadata was reviewed. The raw queries were not fetched or committed. Intent labels can support category or grouping analysis after reviewing sample privacy, but are not sentiment labels. |
| [STS Benchmark](https://huggingface.co/datasets/sentence-transformers/stsb) | Cer et al. 2017. Human similarity ratings for sentence pairs drawn from news, captions and inference tasks. The referenced derivative normalizes ratings to 0–1. | The derivative card has no verified license field. No records were fetched or committed. Continuous similarity on general language does not establish grouping quality for product feedback. |
| [Hugging Face App Reviews](https://huggingface.co/datasets/sealuzh/app_reviews) and [GitHub issue REST API](https://docs.github.com/en/rest/issues/issues) | App Reviews describes about 280,000 reviews across 395 Android apps. GitHub issues are a potential classification source where projects use consistent labels. | The App Reviews card lists its license as unknown. GitHub issue redistribution and privacy require review per repository. No records were fetched or used. Fictional mobile and Jira fixtures retain the stated synthetic purpose. |

Retrieve the optional UCI sample using Python 3.10+ and a trusted HTTPS connection. The script pins the source ZIP by SHA-256, selects 12 records per binary class in fixed hash order, restores source order, and strips surrounding whitespace only. The sample was reviewed for visible personal identifiers. Keep it in temporary storage and avoid extrapolating from it to neutral sentiment, new domains, or deployment quality.

```sh
python scripts/evaluate-datasets-public.py /tmp/soochana-public-sentiment
SOOCHANA_URL=http://127.0.0.1:3141 SOOCHANA_CHROMIUM=/usr/bin/chromium \
  node --experimental-strip-types scripts/evaluate-segmentation.mjs \
  /tmp/soochana-public-result.json "$(git rev-parse HEAD)" --public-sentiment /tmp/soochana-public-sentiment
```

Start the corresponding production build before running the browser command. The external mode reports the full three-class confusion matrix and averages precision, recall and F1 across the two reference classes. Neutral predictions remain visible as disagreements. The recorded Chromium run classified 23 of 24 records correctly. One negative record was predicted neutral. Macro F1 across the two reference classes was 0.978. The sample was deliberately drawn from clearly positive and negative labels, so this result has a narrower scope than the synthetic benchmark. [Measured public sample report](../reports/m10-public-amazon-sentiment.json)

Citation for redistribution or published results using the sample. Kotzias, D., Denil, M., de Freitas, N. and Smyth, P. (2015), *Sentiment Labelled Sentences*, UCI Machine Learning Repository, [DOI 10.24432/C57604](https://doi.org/10.24432/C57604). The source license is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

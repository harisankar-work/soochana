# Soochana evaluation datasets

The [fixture manifest](manifest.json) lists the exact positive-case row counts and input formats. The generator materializes the fixtures from [100 authored reviews](../ground-truth/authored-reviews.tsv) and explicit metadata and validation rules. It reuses the checked-in [96-review demo](../../public/demo/soochana-demo.csv) unchanged. The malformed files are named cases in the loader. Export the input with its row-level reference for browser testing.

```sh
node --experimental-strip-types scripts/evaluate-datasets.mjs --export jira-200 /tmp/soochana-fixtures
node --experimental-strip-types scripts/evaluate-datasets.mjs all /tmp/soochana-deterministic.json
```

| Fixture | Input records | Accepted | Notes |
| --- | ---: | ---: | --- |
| `tiny-10` | 10 | 10 | Comma-delimited smoke sample |
| `small-25` | 25 | 25 | Semicolon-delimited labelled prefix |
| `medium-50` | 50 | 50 | Tab-delimited labelled prefix |
| `demo-96` | 96 | 96 | Original portfolio demo |
| `benchmark-100` | 100 | 100 | Full pre-labelled set |
| `jira-200` | 200 | 196 | UTF-8 BOM, CRLF, quoting, multiline descriptions, date warnings and explicit unmapped fields |
| `large-500` | 500 | 482 | Duplicate, missing, malformed-metadata and long-description cases |
| `stress-1000` | 1,000 | 959 | Import, selection, dashboard and filtering |
| `limit-10000` | 10,000 | 9,554 | Accepted size boundary, import and memory workload |

The malformed cases cover unclosed quotes, control characters, a missing feedback mapping, header-only input, mismatched row width, and one beyond both the row and the column limits. The width case accepts only its valid row. The other cases assert exact user-facing error messages.

Jira-style data is fictional and uses `SYN-` keys. The filename and schema exercise the CSV importer rather than a Jira integration. The expected mapping is Description → feedback, Created at → date, Issue Type → category, and Source → source. Jira issue key, Summary, and Priority remain unmapped CSV fields. Descriptions include reproducible ticket references for evidence checks. Jira-style timestamps without the required ISO date format are retained as rows with a validation warning and a missing parsed date.

The model fixtures use the current 100-record cap. Larger inputs repeat authored patterns with unique synthetic case references to exercise import, selection and UI scale. These repeated patterns are excluded from model-quality comparisons.

The [measured import comparison](../reports/m10-deterministic-import.json) records baseline and candidate timings and confirms identical validations against these expectations. See [reference provenance](../ground-truth/README.md) for labeling and public-data methodology.

## Interface

- [`loadDataset(name)` and `verifyDataset(fixture)`](../../scripts/evaluate-datasets.mjs) expose generated CSV input, reference rows, and exact application comparison.
- [`evaluate-segmentation.mjs`](../../scripts/evaluate-segmentation.mjs) consumes the labelled prefixes and observes real browser worker output.

## Invariants

- The original demo CSV and historical holdout remain unchanged.
- Import references use logical CSV rows, including quoted multiline records.
- Model predictions never update the reference labels. Model measurements use at most 100 imported reviews per run.

## Side Effects

- The deterministic CLI reads local fixtures and can write JSON or CSV to an explicit output location.
- The browser harness reads local fixtures, interacts with an existing app instance, downloads pinned model and runtime assets over HTTPS, and writes results separately.

## Verification

Run `npm run evaluate:datasets -- all` and `npm test`.

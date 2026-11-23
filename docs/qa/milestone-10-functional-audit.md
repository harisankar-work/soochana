# Milestone 10 functional QA

The audit exercises the optimized production build on loopback, using synthetic reviews and the existing public demo CSV. The implementation branch was tested locally. No Vercel settings or deployments were changed.

## Browser runs

| Engine | Widths | Outcome |
| --- | --- | --- |
| Chromium 156.0.8078.79 | 320, 390, 768, 1024, 1440 | Five end-to-end responsive workflows and all 18 dataset, file-limit, and source-selection cases passed. Forty axe state scans returned zero violations. |
| Playwright WebKit 27.2 | 320, 390, 768, 1024, 1440 | Five responsive workflows passed. Forty axe state scans returned zero violations. |
| Firefox 159.0 | 320, 390, 768, 1024, 1440 | Five responsive workflows passed with axe disabled. The full Firefox axe run crashed the browser content process in the constrained test environment. Firefox axe coverage remains unverified. |

The responsive passes observed no page errors or unexpected network requests. Browser timings in the test output include automation and shared-host contention and are unsuitable for the model performance comparison. Playwright WebKit on Linux does not establish Safari platform coverage. Real model lifecycle verification used Chromium only. Screen readers, physical devices, and other networks were outside this run.
The [machine-readable browser evidence](../../evaluation/reports/milestone-10-functional-browser.json) includes the Firefox axe attempt and the successful functional-only rerun.

On Chromium the browser imported the existing 96-record demo and reproduced its 2.93/5 average rating. It also accepted 196 of 200 Jira-style rows, 482 of 500 large rows, 959 of 1,000 stress rows, and 9,554 of 10,000 limit rows. Rejected rows matched the reference. The browser verified the 100-record model selection cap for each of those larger datasets, without running model inference on the whole import.


## Found and fixed

| Severity | Reproduction | Expected and observed | Fix and regression |
| --- | --- | --- | --- |
| Medium | At 320 or 390 CSS pixels, import CSV with a rejected or warning row, then expand **Inspect row issues** in **Review Quality**. | The row issues table should scroll inside its labeled container. Before the fix, the document widened to 531 px in Chromium, pushing parts of the import workflow outside the viewport. | Apply `min-w-0` to the details element so its grid cell can shrink. The browser regression opens the details, checks that document width stays within the viewport, and checks that the table itself still scrolls. |

The overflow was reproduced before the patch at both narrow widths. The same workflow passed at those widths after the patch in the Chromium development run.

## Coverage and assertions

| Area | Browser assertions |
| --- | --- |
| Navigation and layout | Empty Dashboard, Issue Explorer and Prioritization states, active navigation, keyboard skip link, stage focus, evidence heading focus, and overflow checks. |
| Import | File input and browser-dispatched drag-and-drop, invalid extension, empty/oversized/non-UTF-8 files, malformed CSV, missing or reused mappings, duplicate and missing reviews, bounded columns and rows, quoted multilingual text and multiline Jira descriptions, date and rating warnings, search, sorting, quality report, preview, confirmation, replacement, and removal. |
| Datasets and Dashboard | Exact quality totals, average ratings, rated counts, intersection of date/source/rating filters, pagination, evidence chart selection, missing metadata, model selection cap, high-cardinality source entry, and aggregate **Other recorded sources** evidence. The browser selects only a bounded model sample from large datasets. |
| Sentiment and discovery | Real browser model work recovers from a deliberately blocked initial artifact request. Successful tests use the actual pinned artifacts over HTTPS. Assertions cover labels, confidence and ordering, cancellation with partial results, retries, both grouping methods, threshold changes, group search, evidence, and dashboard model coverage. |
| Model reuse | The test observes real worker input counts. It checks that widening an already embedded 20-record sample to 25 sends five records, shrinking back to 20 sends no work, a cancelled 100-record run resumes only missing records, and replacement re-embeds a new review despite reuse of its CSV row ID. |
| Prioritization | Missing-title and missing-evidence errors, explicit CSV row evidence, draft edits and discard, weight validation, reset, discovered group snapshots, and stale snapshot review. For one evidence row, ratings 5/4/4 and weights 30/30/25/15 produce `0.30×5 + 0.30×100 + 0.25×75 + 0.15×75 = 61.50`. Weights 10/50/25/15 produce 80.50. |
| Privacy and state | Manual flows assert same-origin GET/HEAD traffic without request bodies and empty localStorage, sessionStorage, IndexedDB, and Cache Storage after reload. Model tests separately permit the documented HTTPS artifact hosts and reject unexpected origins or request bodies. Refresh and replacement remove old results and scoring state. Browser caches may keep model artifacts. |

Malformed worker messages and invalid predictions are injected in regression tests to validate defensive behavior. They do not count as real model results. The real model lifecycle test deliberately aborts the first Hugging Face request for each model to exercise transport failure. Subsequent attempts use live model requests with TLS verification enabled.

## Reproduce

Build and start the app first. Use Node.js 24 and a Playwright-compatible browser.

```sh
npm run build
npm start -- --port 3142
export SOOCHANA_URL=http://localhost:3142
export SOOCHANA_CHROMIUM=/usr/bin/chromium
node scripts/qa-functional.mjs flows
node --experimental-strip-types scripts/qa-functional.mjs datasets
node scripts/qa-functional.mjs models
```

`flows` defaults to 320, 390, 768, 1024, and 1440 CSS pixels. Set `SOOCHANA_QA_WIDTHS` to reproduce a narrower set. `datasets` runs the entire fixture manifest by default and accepts individual fixture names as arguments. Use `SOOCHANA_BROWSER=firefox` or `SOOCHANA_BROWSER=webkit` with the matching Playwright browser and system libraries installed. `SOOCHANA_QA_AXE=0` skips automated scans while retaining focus and layout assertions. The JSON output records the scan count. All three commands print structured JSON and exit nonzero on an assertion failure, unexpected request, page error, or axe finding.

Chromium model evaluation in the cloud needs Chromium to trust the environment's installed CA certificates. Run on a trusted network or use the environment's existing CAs in a disposable browser profile. Certificate verification stays enabled. The local model audit is separate from any hosted release verification.

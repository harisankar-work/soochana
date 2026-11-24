# Milestone 11 workflow audit

The candidate starts from Milestone 10 commit `e9832bd`. The prior shared layout kept imported feedback and raw model results across in-app navigation. Prioritization still had a second issue-creation process for model groups. Direct entry also blocked title-only manual work. The candidate presents current suggestions and saved issues in one queue and allows editing without a dataset.

## Deterministic behavior

| Case | Expected outcome |
| --- | --- |
| Merge two issues with 12 and 8 distinct reviews | One issue contains all 20 original row IDs |
| Split five from that issue | The source retains 15 and the new issue contains five |
| Move one back | The issues contain 16 and four, with one owner per review |
| Exclude or delete | Original imported rows remain intact. Restored and deleted evidence is available in the appropriate feedback pool |
| Rerun discovery | Saved titles, descriptions, ownership, review state, and judgments survive. Suggestions intersecting saved or explicitly released evidence cannot take ownership |
| Change previously scored evidence | The score is withheld until the owner reconfirms their existing or revised judgments |
| Score one review with assessments 5, 4, 4 | `0.30×5 + 0.30×100 + 0.25×75 + 0.15×75 = 61.50` |
| Title-only manual issue | Issue is editable and exportable, with no score |
| Copy or export | Browser clipboard and downloads are the only output paths. Spreadsheet formula starters are escaped in CSV fields |

The scenario fixture creates IDs and arithmetic independently of application outputs. Unit coverage also rejects conflicting drafts, invalid destination IDs, and competing evidence ownership. The browser suite exercises actual worker downloads, automatic start after confirmation, cancellation, retry, editing, scoring, Jira drafting, exports, replacement, and refresh.

## Privacy and lifecycle

Dataset confirmation starts at most 100 records. The import confirmation checkbox disables automatic discovery in the current session. Model workers remain serialized. Cancelling retains valid partial embeddings, and reanalysis reuses cached embeddings for the same dataset. Clustering waits for completion or cancellation to avoid recalculating groups for every worker result. Current analysis progress is visible while users can continue with manual organization.

Issue history and source material live in memory. History retains at most 20 organization snapshots. Refresh, tab close, and replacement clear associated results and drafts. The first import preserves manual issues with no evidence from a prior dataset. Model asset caching can survive refresh. The browser harness checks request origins and bodies. Clipboard and CSV files can contain original feedback and should be shared only after review.

## Reproduction

Use Node 24, a local production build, and the existing dataset harness. Browser HTTPS must validate against the environment's normal trusted CA certificates.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm start -- --port 3152
export SOOCHANA_URL=http://127.0.0.1:3152
export SOOCHANA_CHROMIUM=/usr/bin/chromium
npm run qa:demo
npm run evaluate:datasets -- all
npm run qa:product
node scripts/qa-functional.mjs flows
node scripts/qa-functional.mjs datasets
node scripts/qa-functional.mjs models
```

Use `SOOCHANA_BROWSER=firefox` or `SOOCHANA_BROWSER=webkit` with local browser binaries for the responsive suite. [Grouping evaluation](../../evaluation/reports/milestone-11-grouping.md)

## Observed results

Type checking, lint, the production build, and all 96 tests across nine suites passed. The deterministic harness passed all 16 dataset cases. The Chromium browser dataset suite passed all 18 import, file-limit, and source-selection cases. The separate 96-review portfolio demo passed at 320, 390, and 1440 px.

| Browser | Responsive widths | Result |
| --- | --- | --- |
| Chromium 156 | 320, 390, 768, 1024, 1440 | Functional and keyboard checks passed, 40 axe scans with zero violations |
| Playwright WebKit 27.2 on Linux | Same five | Functional and keyboard checks passed, 40 axe scans with zero violations |
| Firefox 159 | Same five | Functional and keyboard checks passed. Axe was omitted after Firefox content-process instability during the Milestone 10 audit |

The real Chromium product run passed the connected workflow on the existing demo, including automatic start, cancellation and retry, group edits, reassessment, Jira clipboard copying, both CSV downloads, spreadsheet escaping, replacement, and refresh. The issue review and Jira draft states fit all five widths. Four targeted axe scans at 320 and 1440 px returned zero violations. The test recorded no page errors or unexpected network origins or bodies.

The following single observations measure from import confirmation or retry to the completed Issue Explorer view. The warm cases reused downloaded model assets while replacing the dataset and therefore computed fresh embeddings. The shared host ran other browser checks concurrently. These values are descriptive elapsed times.

| Reviews | Trigger | Elapsed |
| ---: | --- | ---: |
| 96 | Retry after cancelling the first automatic run | 7.99 s |
| 25 | Warm confirmed import | 5.85 s |
| 50 | Warm confirmed import | 7.97 s |
| 100 | Warm confirmed import | 11.59 s |
| 96 | Warm confirmed demo import | 13.28 s |

We did not measure peak native or browser process memory, run model inference in Firefox or WebKit, or test screen readers and physical devices. Suggested individual assignments use a cosine heuristic over existing cached evidence. They were exercised as proposals, and their accuracy has no independent validation.

[Product workflow results](../../evaluation/reports/milestone-11-workflow.json) · [Walkthrough and screenshots](../demo/milestone-11-workflow.md)

The real-worker Chromium lifecycle suite also passed initial artifact failure and retry for each model, partial cancellation, cached scope expansion, replacement isolation, and 15 axe scans with zero findings. Invalid worker payloads are covered separately by deterministic regression tests. [Browser and lifecycle evidence](../../evaluation/reports/milestone-11-browser.json)

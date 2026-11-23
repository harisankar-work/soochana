# VoiceLoop Milestone 7 release-readiness audit

**Status: PARTIAL.** VoiceLoop is conditionally ready for a controlled Chromium demo with a verified warm model cache. Unrestricted release of model-dependent workflows is blocked pending direct cold-start verification. Grouping and prioritization require human review. No deployment was performed.

## Scope and environment

The audit started at `b9fd486bb58bbb28b74402fb2d8c89e94de2b51e` on `main`. The production build, checked-in fixtures, audit scripts, and commit containing this report identify the tested revision. The design submodule stayed pinned at `91e15664896f6f27e75dcf1414d1226cb95fa167`.

Tests ran on 23 November 2026 on Debian 13 x64 with a shared AMD EPYC 9V74 host, a two-vCPU quota, and headless Chromium 156.0.8078.79. Model tests used browser WASM. Fixtures were synthetic. This audit was conducted by the implementation team.

## Quality gates and browser coverage

| Check | Result | Evidence |
| --- | --- | --- |
| Standard clean install | FAIL | Optional `onnxruntime-node` binary download failed with connection refusal and unreachable network errors. |
| Clean install with `ONNXRUNTIME_NODE_INSTALL=skip` | PASS | 473 packages installed. Browser WASM inference was subsequently exercised. |
| Type checking, lint, production build | PASS | All three commands exited successfully. |
| Unit tests | PASS | Starting revision 79 tests. Release candidate 80 tests across seven suites. |
| Chromium production browser regression | PASS | Passed at 320, 390, and 1440 CSS pixels, including real inferences through staged artifacts, issue cutoff and lifecycle, and prioritization reconciliation. |
| Firefox, WebKit, physical mobile devices | NOT RUN | Browser engines and physical devices unavailable in the test environment. |
| Keyboard and automated accessibility | PASS | Skip link, keyboard controls, chart activation, focus after issue creation, and narrow layouts. Zero axe violations across 15 scanned states after fixes. |
| Screen readers and formal WCAG conformance | NOT RUN | Requires hands-on testing with assistive technologies. |

Browser and unit coverage includes CSV selection, mapping, invalid data, filtering and navigation, evidence selection, editable review, recalculation, and refresh. Worker unit coverage checks cancellation, stale replies, invalid outputs, and retries. Cancellation and navigation combinations are covered to varying degrees across the unit and browser suites. Cross-engine workflows remain unverified.

## Security and privacy

- **PASS** for targeted testing. Browser checks inspected outbound requests and browser storage with synthetic feedback. The main application workflow made zero external requests. Inference requested approved model and WASM artifacts, with no observed feedback payloads. The smoke workflow left browser data stores empty, and refresh cleared session feedback. Model artifacts may persist in the browser cache.
- **PASS** for dependency audit. npm reported zero advisories before and after adding axe-core. The production build emitted one 53-byte map with zero sources. Evidence text rendered as text. Source inspection covered HTML injection sinks, browser storage, network calls, and diagnostic logging.
- **PASS** for bounded CSV input. The byte and row limits remain 5 MiB and 10,000 rows. The 200-column limit prevents an oversized mapping form. A wide file may still allocate its parsed cells within the byte limit before rejection.
- **NOT RUN** for an independent penetration test. Cold inference depends on third-party artifact availability and the browser trust store. Export is outside this release.

## Performance

The final Chromium run used synthetic disk files while a separate browser workflow was active on the shared host. The harness measured time from interaction through the expected rendered state. Main-thread tasks of at least 50 ms were observed during the workflow. JavaScript heap samples omit native and worker memory. These timings are environment-specific.

| Rows | Bytes | Parse and mapping | Validation and render | Search | Dashboard | Pagination |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 4,865 | 336 ms | 87 ms | 23 ms | 125 ms | — |
| 100 | 48,515 | 142 ms | 71 ms | 29 ms | 95 ms | 89 ms |
| 1,000 | 485,915 | 463 ms | 118 ms | 82 ms | 104 ms | 98 ms |
| 10,000 | 4,868,915 | 271 ms | 286 ms | 138 ms | 166 ms | 118 ms |

The final 10,000-row run observed 80 ms, 199 ms, and 68 ms long tasks and sampled 23.8 MB of JavaScript heap. The earlier main-thread comparison reached mapping in 232 ms and recorded 61 ms and 78 ms long tasks at 10,000 rows and a 26.5 MB JavaScript heap sample. An earlier in-memory Playwright upload recorded an 816 ms task, with file injection included. In the matched disk trial a temporary CSV worker took 349 ms through mapping and recorded a 168 ms long task. The candidate retains main-thread parsing because that experiment did not establish an improvement.

Node microbenchmark medians at 10,000 rows were 40.37 ms for parsing, 34.11 ms for validation, and 11.57 ms for dashboard aggregation. With 100 inputs, similarity matrix construction took 3.95 ms, complete-link threshold recalculation 0.61 ms, and ranking 0.064 ms. Five benchmark cases passed. Peak memory, repeated sustained use, and low-memory mobile performance remain unverified.

## Model transport and inference

| Scenario | Sentiment | MiniLM | Result |
| --- | --- | --- | --- |
| Direct cold start, isolated Chromium profiles | TLS error at `tokenizer_config.json` after 0.28 s | TLS error at `config.json` after 1.02 s | BLOCKED. Zero artifact bytes, no HTTP status, no inference. |
| Staged cold inference, 10 inputs | 21.69 s total, 19.85 s load and init, 1.62 s inference, 6 model requests | 5.98 s total, 4.99 s load and init, 0.52 s inference, 7 model requests | PASS in instrumented Chromium. |
| Warm inference, 100 inputs | 10.61 s total, 2.28 s load and init, 7.79 s inference | 5.45 s total, 1.45 s load and init, 3.46 s inference | PASS. Zero model-host requests in either run. |

Direct cold probes returned `net::ERR_CERT_AUTHORITY_INVALID`. For the inference checks only, the staged transport uses trusted HTTPS via curl and checks pinned model weight digests before fulfilling browser requests. Observed staged time includes artifact staging. The direct probe and production app use their normal transport.

## Sentiment evaluation

**PASS** for real inference and repeatability on the 36 labeled synthetic examples. Chromium matched 30 of 36 labels for 83.3% accuracy and macro F1 of 0.834. Rows in the confusion matrix are expected labels and columns are predicted labels in the order Negative, Neutral, Positive. The matrix was `[[9,3,0],[0,12,0],[1,2,9]]`.

| Class | Precision | Recall | F1 |
| --- | ---: | ---: | ---: |
| Negative | .900 | .750 | .818 |
| Neutral | .706 | 1.000 | .828 |
| Positive | 1.000 | .750 | .857 |

Three negative and two positive examples were labeled neutral. One positive was labeled negative. Indirect and mixed statements remain weak spots. The fixtures do not establish performance on customer datasets, other languages, or distribution shifts.

## Semantic grouping evaluation

**PASS** for real embedding inference and evaluation repeatability. **FAIL** as evidence for dependable unsupervised issue discovery. Pairwise counts refer to feedback pairs grouped together.

| Fixture | Method and cutoff | Precision | Recall | F1 | Correct / incorrect / missed |
| --- | --- | ---: | ---: | ---: | --- |
| 48-row baseline | Complete-link .75 | .667 | .019 | .037 | 2 / 1 / 103 |
| 48-row baseline | Average-link .45 | .677 | .619 | .647 | 65 / 31 / 40 |
| 46-row holdout | Complete-link .75 | .000 | .000 | .000 | 0 / 0 / 54 |
| 46-row holdout | Average-link .45 | .431 | .463 | .446 | 25 / 33 / 29 |

Baseline and holdout took 9.82 s and 9.67 s through embeddings. Complete-link left all 46 holdout rows as singletons. Average-link produced seven baseline singletons and 11 holdout singletons, with average within-group cohesion of .543 and .524. The holdout has more incorrect than correct pairs for average-link. Keep the reviewed production strategy and threshold unchanged. Future evaluation should use independently reviewed labels, a larger untouched holdout and a threshold frozen before the run.

## Analytical checks and prioritization

**PASS** for deterministic dashboard and prioritization calculations. The tests cover filter intersections, denominators, limited model coverage, score normalization, weight changes, tie-breaking, stale evidence and draft handling. The review workflow distinguishes human-entered severity, relative business impact, and evidence confidence from observed supporting reviews. Frequency counts distinct reviews against a fixed benchmark of 20 and caps at 100%. Weights total 100%, scores are bounded from 0 to 100, and missing assessments leave the issue unscored. Issues retain their provenance, flag stale snapshots and link to supporting feedback. Sensitivity describes how rankings respond to selected weights. In Chromium, the synthetic ranking returned 46.75 and 45.25 under default weights and visibly changed when weights were adjusted. Score interpretation is limited to relative ordering under those weights and assessments.

## Defects and verification

| Severity | Reproduction and expected behavior | Root cause and fix | Verification |
| --- | --- | --- | --- |
| Serious accessibility | Activate a populated dashboard chart with voice or keyboard. Its accessible name should contain its visible label. | Custom chart button names differed from their visible label. Native text now supplies the label and value in `src/features/analytics/charts.tsx`. | Chromium axe and keyboard regression PASS. |
| Serious accessibility | Inspect metric lists on the populated dashboard, sentiment and prioritization views. Terms and definitions should retain native semantics. | Secondary text and the sentiment meter were direct siblings of definitions. Markup now nests them inside their definitions in `dashboard.tsx`, `sentiment-panel.tsx`, and `priority-detail.tsx`. Styles in `globals.css` preserve the visual hierarchy. | Chromium axe regression PASS. |
| Moderate robustness | Send a null worker payload, invalid progress or a malformed error message. The UI should remain stable. | Receivers in `use-issues.ts` and `use-sentiment.ts` expected object messages and displayable progress and errors. They now safely ignore or normalize malformed inputs. | Worker receiver regressions PASS. |
| Moderate resource use | Upload a CSV with more than 200 columns. The import should provide actionable feedback rather than generate an oversized mapping form. | The byte and row limits omitted the header count. `csv.ts` enforces the column limit and the import UI documents it. | The 200/201-column boundary test PASS. |
| Release blocker | Run the direct cold probe with a fresh Chromium profile. The model should acquire and initialize its artifacts. | The tested browser rejected the remote certificate chain. Root cause beyond the browser's trust failure remains unresolved. | Direct probe BLOCKED. Staged inference PASS. |

## Release recommendation

| Area | Readiness |
| --- | --- |
| Static shell | READY in tested Chromium. |
| CSV import | CONDITIONALLY READY within the documented limits and tested Chromium scope. |
| Dashboard | READY for a Chromium demo using the documented filters and denominators. |
| Prioritization | READY for a Chromium demo with human-entered assessments. |
| Privacy | CONDITIONALLY READY based on targeted checks and subject to third-party model artifact availability. |
| Accessibility | CONDITIONALLY READY based on automated and manual keyboard coverage in Chromium. |
| Performance | CONDITIONALLY READY on the tested configuration. Near-limit imports can produce visible main-thread delays. |
| Sentiment and semantic grouping | CONDITIONALLY READY for a controlled Chromium demo with verified cached artifacts and human review. |
| Unrestricted model-dependent public use | BLOCKED pending successful direct cold downloads on the release network and browsers. |
| Cross-browser and assistive-technology support | NOT RUN outside the scope documented above. |

Release risk is highest for first-time model access and the adequacy of grouping suggestions. Remaining checks include direct downloads through the intended release network, Firefox and WebKit, screen readers, mobile memory, and independent review of model quality.

## Reproduction and evidence

Run the quality gates, then start the production build. Use the optional installer skip only if the optional Node binary download fails.

```sh
npm ci
ONNXRUNTIME_NODE_INSTALL=skip npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm start -- --port 3115
```

In another shell, point the harnesses at the running build and a compatible Chromium executable. The evaluation commands stage artifacts only when the opt-in variable is present.

```sh
export VOICELOOP_URL=http://127.0.0.1:3115
export VOICELOOP_CHROMIUM=/usr/bin/chromium
npm audit --json
npm run qa:browser
npm run qa:cold
npm run qa:benchmark
npm run qa:calculations
npm run qa:models
VOICELOOP_QA_STAGE_MODELS=1 npm run evaluate:sentiment
VOICELOOP_QA_STAGE_MODELS=1 npm run evaluate:issues -- baseline average-link-v1 0.45
VOICELOOP_QA_STAGE_MODELS=1 npm run evaluate:issues -- holdout average-link-v1 0.45
```

The harnesses emit JSON evidence and the test commands print pass counts. Test harnesses and synthetic fixtures are versioned with the application. Model weights stay outside the repository.

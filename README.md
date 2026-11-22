# VoiceLoop

**Turn customer feedback into product decisions.**

VoiceLoop is a customer feedback intelligence workspace for product managers, product and business analysts, customer experience and operations teams, and founders. Reviews and support tickets often arrive in separate tools and describe the same problem in different words. VoiceLoop aims to bring that feedback together and help teams decide what to investigate, with links back to the original evidence.

## Milestone 1

The workspace includes a responsive Dashboard, Feedback Analysis, Issue Explorer, and Prioritization. The dashboard displays empty states for four metrics and links to the feedback page. Issue Explorer and Prioritization explain their planned functionality.

The app uses Next.js App Router, React, TypeScript, Tailwind CSS, Lucide, Papa Parse, and locally bundled Manrope and Newsreader fonts. ESLint, Vitest, jsdom, and React Testing Library verify the code and UI.

## Milestone 2

Open **Feedback Analysis**, browse for or drop a CSV, review the detected column mappings, inspect the quality report, and search, sort, or page through accepted feedback. Confirm the import to keep the dataset in memory. The summary lets you reopen the preview or confirm a removal or replacement.

### CSV format

Use UTF-8 with or without a BOM, a header row, and one feedback entry per data record. Comma, semicolon, and tab delimiters are detected automatically. Quoted fields can contain delimiters, escaped quotes, and line breaks. Both LF and CRLF line endings are supported.

| Field | Example headers | Accepted values |
| --- | --- | --- |
| Feedback text (required) | review, review_text, feedback, feedback_text, text, comment, message, ticket_description, description | Nonblank text, up to 10,000 UTF-16 code units before trimming |
| Date | date, created_at, timestamp, submitted_at | Valid calendar date in YYYY-MM-DD format |
| Source | source, channel, platform | Free text |
| Rating | rating, stars, score | Decimal number from 1 to 5, inclusive |
| Category | category, topic, issue_type | Free text |

Matching ignores case and treats spaces and hyphens in headers like underscores. Ambiguous headers require manual selection. Each source column can map to one field.

### Limits and validation

- MVP limits are 5 MiB per file and 10,000 data records. Files over either limit are rejected. Malformed quoting and invalid UTF-8 also reject the file.
- Each accepted row keeps its original feedback, trimmed display text, stable ID within the dataset, and logical CSV record number. The header is record 1 and a multiline quoted record counts as one row.
- Blank feedback, feedback over the length limit, and mismatched field counts exclude a record. Blank data records count as missing feedback. The quality report shows one exclusion reason per row.
- Duplicates use trimmed, case-insensitive feedback text with consecutive whitespace collapsed. The first eligible row wins, even when a later copy has different metadata. Similar wording remains separate. Duplicate and missing counts are subsets of rejected records.
- Invalid dates or ratings on accepted rows produce warnings and are stored as missing. Blank optional values remain missing. Date-time strings, localized dates, and ratings outside the supported range require cleanup in the CSV source.

### Session and privacy

CSV content is read, parsed, and previewed in the browser. The app keeps confirmed records in React memory across in-app navigation. A refresh or tab close clears them. This workflow has no upload endpoint, persistent browser storage, analytics tracking, or server-side processing. Milestone 3 also runs inference locally. See the model download details below.

Import and preview handle one dataset at a time. Parsing and validation run on the browser's main thread within the stated limits. Clustering, dashboard analytics, scoring, storage, exports and deployment remain future work.

### Try a CSV import

Save the following synthetic content to a local file named `test-feedback.csv`.

```csv
review,date,source,rating
"The app crashes during payment",2026-11-01,App Store,1
"Delivery was quick and easy",2026-11-02,Play Store,5
"Payment fails every time",2026-11-03,Support,2
```

Run the app and open **Feedback Analysis → Browse CSV**. Verify that Feedback text, Date, Source, and Rating are mapped. Select **Review quality** and check for three accepted records and zero rejections. Select **Preview accepted records** and search for `payment` to see two matches. Clear the search and sort by rating. Select **Continue to confirmation → Import 3 feedback records**, then **View imported feedback**.

## Milestone 3

After confirming a dataset in **Feedback Analysis**, choose a scope and select **Analyse Sentiment**. The default is the first 100 accepted records in CSV order, or the whole dataset when it has fewer. The panel shows progress, failures, unanalysed records, sentiment totals for the analysed subset, and searchable review-level predictions. The configurable confidence threshold flags results for manual inspection. Confidence is the model's assigned score. Empirical accuracy is measured separately.

### Model and browser privacy

VoiceLoop runs [Xenova/twitter-roberta-base-sentiment-latest](https://huggingface.co/Xenova/twitter-roberta-base-sentiment-latest) at revision `f3ec4d0925f90c3ca7ee7814f52d6ee7cf180445`, using Transformers.js 4.3.2 and ONNX Runtime WASM in a dedicated module Web Worker. This is Xenova's quantized ONNX conversion of [Twitter-roBERTa-base for Sentiment Analysis](https://huggingface.co/cardiffnlp/twitter-roberta-base-sentiment-latest) by CardiffNLP, whose model card specifies [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The conversion card links the original and lists no separate license. Transformers.js is [Apache-2.0](https://github.com/huggingface/transformers.js/blob/main/LICENSE).

Model indices are **0 Negative, 1 Neutral, 2 Positive**. The quantized model file is 125,905,426 bytes (120.1 MiB), plus tokenizer, configuration and WASM assets. Use a current browser with Web Workers and WebAssembly, available memory, and internet access for the initial download. Model files come from Hugging Face and runtime files come from jsDelivr. Cache Storage can retain model and runtime assets where available, subject to browser limits and eviction. **The browser downloads model files. Customer feedback is analysed locally and is never uploaded for inference.** Reviews and predictions are held only in session memory.

The worker processes one review at a time. A completed run can reuse its loaded model. Cancel terminates the worker and labels any results already received as partial. Restarting creates a new run and may reload assets. Replacing or removing the dataset cancels analysis and clears its predictions. Navigation retains the current session. Refreshing clears it.

The model was trained on English tweets and fine-tuned on TweetEval. Product feedback is a different domain. Sarcasm, negation, mixed opinions, short reports, and other languages can mislead the classifier. Long inputs are truncated by the tokenizer while the full review remains available in the UI.

### Synthetic evaluation

The [fixture](evaluation/sentiment-fixture.json) contains 36 synthetic English reviews, 12 per class. The implementing assistant assigned reference labels before inference. The examples received no independent human annotation or adjudication. This is an exploratory baseline.

Chromium ran the real pinned model in WASM. Accuracy was **83.3% (30/36)** and macro F1 was **0.834**. The confusion matrix uses reference labels as rows and predicted labels as columns in Negative, Neutral, Positive order. Its rows are `[9, 3, 0]`, `[0, 12, 0]`, and `[1, 2, 9]`. Misses included implicit complaints about late delivery and battery drain, praise phrased as the end of an earlier problem, and a review that contrasted expected difficulty with quick setup.

The cloud Chromium build rejected the model host's TLS certificate. During verification, the test harness streamed the real pinned model and runtime artifacts fetched by the workspace's trusted HTTPS client. The application worker and inference code were unchanged. Normal browser runs fetch the assets directly.

To reproduce, build and start with `npm run build` and `npm start`. Run `VOICELOOP_CHROMIUM=/path/to/chromium npm run evaluate:sentiment` with a current Chrome or Chromium executable. Set `VOICELOOP_URL` if the app uses a different address. The script imports the fixture through the app and prints real browser predictions, per-class metrics, the confusion matrix, and the five smoke cases.

## Local setup

Use Node.js 22.13 or later in the 22.x line, or Node.js 24 or later, and npm.

```bash
git clone --recurse-submodules https://github.com/harisankar-work/voiceloop.git
cd voiceloop
git submodule update --init --recursive
npm ci
npm run dev
```

When the optional ONNX Runtime Node GPU download is blocked, use `ONNXRUNTIME_NODE_INSTALL=skip npm ci`. VoiceLoop uses the browser WASM runtime.

For an existing checkout, start with the submodule command from the project root. Open [VoiceLoop locally](http://localhost:3000).

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm start
```

## Design system

The [Apple Design Skill](https://github.com/dickwu/apple-design-skill) is pinned as a Git submodule at `.design-rules`. The app adapts its guidance for a browser-based workspace.

- **Layout and typography** use consistent card spacing, a readable type hierarchy, and grids that adapt to narrow viewports.
- **Accessibility and color** use semantic landmarks, a skip link, visible focus indicators, labelled icons where needed, and a text underline alongside the active navigation color.
- **Sidebars and buttons** inform the desktop sidebar, the compact grid of links on mobile, and the single prominent dashboard action. Navigation links and the primary action have 44 CSS pixel minimum heights.
- **Writing and feedback** inform explicit empty states, inline CSV errors with recovery steps, and file status near the upload controls. The import provides a browse button alongside drag and drop, labelled mapping controls, and a horizontally scrollable preview table.

## Roadmap

| Milestone | Planned work |
| --- | --- |
| 2 | Implemented CSV import, column mapping, row validation, duplicate detection, and searchable preview |
| 3 | Implemented browser-based, pretrained sentiment classification with Transformers.js |
| 4 | Use MiniLM embeddings to group related feedback and evaluate the clusters |
| 5 | Show feedback metrics, sentiment, trends, issue frequency, and filters |
| 6 | Add transparent scoring, configurable weights, and evidence-backed recommendations |
| 7 | Evaluate model quality, accessibility, browser behavior, performance, and security |
| 8 | Prepare a public demo dataset and deploy to Vercel after approval |

Future exports will let teams share reports with supporting evidence.

## License

VoiceLoop application code is available under the [MIT License](LICENSE). The design reference retains its upstream terms.

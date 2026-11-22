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

CSV content is read, parsed, and previewed in the browser. The app keeps confirmed records in React memory across in-app navigation. A refresh or tab close clears them. This workflow has no upload endpoint, persistent browser storage, analytics tracking, or server-side processing. This privacy behavior applies to Milestone 2. Future inference needs a separate privacy review.

Import and preview handle one dataset at a time. Parsing and validation run on the browser's main thread within the stated limits. Sentiment analysis, clustering, dashboard analytics, scoring, storage, exports and deployment remain future work.

### Try a CSV import

Save the following synthetic content to a local file named `test-feedback.csv`.

```csv
review,date,source,rating
"The app crashes during payment",2026-11-01,App Store,1
"Delivery was quick and easy",2026-11-02,Play Store,5
"Payment fails every time",2026-11-03,Support,2
```

Run the app and open **Feedback Analysis → Browse CSV**. Verify that Feedback text, Date, Source, and Rating are mapped. Select **Review quality** and check for three accepted records and zero rejections. Select **Preview accepted records** and search for `payment` to see two matches. Clear the search and sort by rating. Select **Continue to confirmation → Import 3 feedback records**, then **View imported feedback**.

## Local setup

Use Node.js 22.13 or later in the 22.x line, or Node.js 24 or later, and npm.

```bash
git clone --recurse-submodules https://github.com/harisankar-work/voiceloop.git
cd voiceloop
git submodule update --init --recursive
npm ci
npm run dev
```

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
| 3 | Evaluate lightweight pretrained sentiment classification with Transformers.js |
| 4 | Use MiniLM embeddings to group related feedback and evaluate the clusters |
| 5 | Show feedback metrics, sentiment, trends, issue frequency, and filters |
| 6 | Add transparent scoring, configurable weights, and evidence-backed recommendations |
| 7 | Evaluate model quality, accessibility, browser behavior, performance, and security |
| 8 | Prepare a public demo dataset and deploy to Vercel after approval |

Future exports will let teams share reports with supporting evidence.

## License

VoiceLoop application code is available under the [MIT License](LICENSE). The design reference retains its upstream terms.

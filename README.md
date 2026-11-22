# VoiceLoop

**Turn customer feedback into product decisions.**

VoiceLoop is a customer feedback intelligence workspace for product managers, product and business analysts, customer experience and operations teams, and founders. Reviews and support tickets often arrive in separate tools and describe the same problem in different words. VoiceLoop aims to bring that feedback together and help teams decide what to investigate, with links back to the original evidence.

## Milestone 1

The workspace includes a responsive Dashboard, Feedback Analysis, Issue Explorer, and Prioritization. The dashboard displays empty states for four metrics and links to the feedback page. Each feature page explains the planned functionality. CSV uploads, storage, AI inference, analytics, scoring, and exports are future work.

The app uses Next.js App Router, React, TypeScript, Tailwind CSS, Lucide, and locally bundled Manrope and Newsreader fonts. ESLint, Vitest, jsdom, and React Testing Library verify the code and UI.

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
- **Writing and feedback** inform explicit empty states that explain what visitors can do and when additional features are planned.

## Roadmap

| Milestone | Planned work |
| --- | --- |
| 2 | Parse and validate CSV uploads, map columns, detect duplicates, and preview rows |
| 3 | Evaluate lightweight pretrained sentiment classification with Transformers.js |
| 4 | Use MiniLM embeddings to group related feedback and evaluate the clusters |
| 5 | Show feedback metrics, sentiment, trends, issue frequency, and filters |
| 6 | Add transparent scoring, configurable weights, and evidence-backed recommendations |
| 7 | Evaluate model quality, accessibility, browser behavior, performance, and security |
| 8 | Prepare a public demo dataset and deploy to Vercel after approval |

Future exports will let teams share reports with supporting evidence.

## License

VoiceLoop application code is available under the [MIT License](LICENSE). The design reference retains its upstream terms.

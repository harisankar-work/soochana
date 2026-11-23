# VoiceLoop release plan

## Candidate and approval

Use the Milestone 8 commit on `main` as the release candidate. Deployment and publishing a preview require separate approval. Before wiring Git integration, check the target project and account for automatic production and preview deployments, and keep those disabled until authorized.

## Vercel configuration

- Import the GitHub repository root as a Next.js project. Use the supported Node.js 24.x runtime and the checked-in npm lockfile.
- Use `npm ci` and `npm run build`. If installation fails specifically on optional ONNX Runtime Node binaries, set the install command to `ONNXRUNTIME_NODE_INSTALL=skip npm ci` and reverify browser inference.
- The demo CSV is served from `public/demo`. The core flow needs no account, database, Vercel AI Gateway, secret, or server-side inference. Confirm the worker and static asset responses on the approved host.
- Keep the pinned model revisions and existing privacy claims. If adding a Content Security Policy, validate the pinned Hugging Face artifact and redirect hosts and the jsDelivr WASM runtime over HTTPS. Verify worker and WASM execution under that policy. Never disable TLS checks to resolve artifact failures.

## Gates after approval

- [ ] Confirm the release commit, Git settings, project ownership, production domain, and rollback target.
- [ ] Verify type check, lint, tests, build, and `qa:demo` on the candidate.
- [ ] Verify production pages and the demo asset from the approved host, including manual scoring and browser session reset.
- [ ] In clean profiles on the intended release network, verify both genuine cold artifact downloads and real inference. Repeat with a warm cache and check network payloads. Document Chromium, Firefox, and WebKit results and the supported browser scope.
- [ ] Verify keyboard navigation and representative assistive technology on the deployed UI.
- [ ] Once approved, test the authorized deployment before routing production traffic to it. If smoke checks fail, restore the previous known-good deployment if one exists, or keep the first release unpublished.
- [ ] Update release notes with model and browser limits. Do not treat synthetic evaluation scores as customer outcomes.

The manual demo path works independently of the model network. The public model-dependent release remains contingent on ordinary cold-start verification and the supported browser scope.

[Vercel deployment documentation](https://vercel.com/docs/deployments) · [Milestone 7 QA and evaluation](../qa/milestone-7-report.md)

## Local cold-start evidence

Debian 13 with Chromium 156 reproduced `ERR_CERT_AUTHORITY_INVALID` for both models using fresh default profiles. The first Hugging Face requests failed before receiving an HTTP response or any artifact bytes. System curl, using its configured trust store, reached the pinned Hugging Face path over HTTPS.

Both direct downloads and real inference then passed in fresh Chromium contexts when a temporary NSS trust store was populated from the environment's preinstalled CA certificates. No requests were intercepted, no artifacts were staged, and TLS certificate validation stayed enabled. Chromium reached Hugging Face, its artifact CDN, and the jsDelivr WASM runtime. The temporary trust store was removed after testing. This identifies a trust-store mismatch in the test environment. Vercel-hosted verification and a check from the intended audience's network are pending.

On the 96-review fixture, sentiment and embedding inference both completed using that same direct HTTPS setup. MiniLM embedded all 96 rows with zero failures. Complete-link at 0.75 produced no groups. Exploratory average-link at 0.45 produced 23 groups covering 64 reviews. These counts describe this demo run and do not measure grouping accuracy.

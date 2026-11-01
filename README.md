# Attest

Attest turns local git history into a portable, revocable credential at `attest.sh/v/{handle}`. Each claim links to a commit, changed files, a quoted excerpt, and a tamper-evident SHA-256 chain. Attest means **these specific claims have supporting evidence**—not that a person is good.

Evidence comes before scores. Assessment scores are shown with exact quotes from the candidate's submission; absent or ungrounded evidence produces `null`. Language is limited to **Supported**, **Partially supported**, **Unverified**, and **Contradicted**. The product never calls people dishonest, and an empty result says **No significant signals detected**. Local scans are private; nothing uploads unless the user runs `attest sync` and confirms the exact request preview.

## Stack

- `apps/web`: Vite, React, Tailwind, CodeMirror; deploy the `apps/web` build output to Cloudflare Pages.
- `apps/api`: Hono on Cloudflare Workers; GitHub OAuth/device flow, D1, R2, Queues, Workers AI, and an optional AI Gateway or Meta Llama API provider.
- `packages/cli`: Node.js CLI published as `npx attest`; scans git history, saves a local preview, and syncs only after confirmation.
- `packages/core`: shared evidence contracts and deterministic chain hashing.

## Local development

Requirements: Node.js 20+, npm, Git, and Wrangler.

```sh
npm install
npm run dev:api
npm run dev
```

In another terminal, apply the schema to local D1:

```sh
npm run db:local -w @attest/api
```

Set local Worker secrets in `apps/api/.dev.vars` (copy `.dev.vars.example` and replace the placeholders). Register a GitHub OAuth app with callback `http://127.0.0.1:8787/api/auth/github/callback` for local browser sign-in. Set `GH_CLIENT_ID`, `GH_CLIENT_SECRET`, `SESSION_SECRET` (a long random value), and `APP_ORIGIN=http://127.0.0.1:5173`. GitHub device flow is used by the CLI.

Open `http://localhost:5173`. In any git repository, the CLI commands are:

```sh
npx attest login
npx attest scan
npx attest sync
npx attest wipe
```

`scan` writes only to `.attest/scan.json`; it does not upload. `sync` prints the complete JSON request, explains that it replaces the previous evidence snapshot, asks for confirmation, and only then uploads it. `wipe` requires a separate confirmation and deletes that account's uploaded evidence, assessments, and R2 artifacts.

## Cloudflare resources and deployment

The Worker config is `apps/api/wrangler.toml`; D1 schema and the initial rubric are in `apps/api/schema.sql`. Provision these resources in your Cloudflare account (resource creation and deploy are intentionally not run by this repo setup):

```sh
npx wrangler d1 create attest-db
npx wrangler r2 bucket create attest-artifacts
npx wrangler queues create grade-queue
```

Copy the D1 database ID into `apps/api/wrangler.toml`. Configure the Worker's `AI` binding (Llama 3.3 70B and Llama 4 Scout are invoked by the API), and set production secrets:

```sh
npx wrangler secret put GH_CLIENT_ID
npx wrangler secret put GH_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

Set `APP_ORIGIN=https://attest.sh`. For AI Gateway observability, set `AI_GATEWAY_BASE_URL` to the account/gateway Workers AI endpoint and optionally `AI_GATEWAY_TOKEN`. If `META_LLAMA_API_KEY` is set, the pluggable client uses Meta's OpenAI-compatible endpoint instead of the Workers AI binding.

Deploy the Worker with `npm run deploy -w @attest/api`, then publish `apps/web` as a Cloudflare Pages project with build command `npm run build -w @attest/web` and output directory `apps/web/dist`. The Worker route in `wrangler.toml` serves `/api/*` on `attest.sh`.

To publish the CLI as `npx attest`, publish the public `@attest/core` workspace first, then `packages/cli` (`npm publish -w @attest/core`, then `npm publish -w attest`). Set `VITE_AI_GATEWAY_DASHBOARD_URL` in the Pages build environment to show a dashboard link on assessment results.

## API

- `POST /api/cli/sync` verifies and stores a locally built evidence chain.
- `DELETE /api/cli/wipe` removes uploaded evidence, assessments, and R2 artifacts for the authenticated user.
- `POST /api/test/generate` creates an evidence-specific exercise with Llama 3.3 70B.
- `POST /api/test/submit` stores the submission and queues grading.
- `GET /api/test/:id` returns both grading passes, exact evidence quotes, agreement, and review status.
- `GET /api/evidence/:handle` returns the public evidence profile and assessment outcomes.
- `GET /api/og/:handle` serves the profile social-preview image.

The queue runs Llama 3.3 70B and Llama 4 Scout independently. A score difference greater than 8 points, missing grounded scores, or grader confidence below 0.7 requires human review.

Commit references support review of what is recorded in repository history; a local scan does not independently prove who authored a change. Scores and profile copy must not imply authorship or overall personal merit.

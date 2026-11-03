# Attest

Attest turns local git history into a portable, revocable credential at `attest.sh/v/{handle}`. Each claim links to a commit, changed files, a quoted excerpt, and a tamper-evident SHA-256 chain. Attest means **these specific claims have supporting evidence**—not that a person is good.

Evidence comes before scores. Assessment scores are shown with exact quotes from the candidate's submission; absent or ungrounded evidence produces `null`. Language is limited to **Supported**, **Partially supported**, **Unverified**, and **Contradicted**. The product never calls people dishonest, and an empty result says **No significant signals detected**. Local scans are private; nothing uploads unless the user runs `attest sync` and confirms the exact request preview.

## Stack

- `apps/web`: Vite, React, Tailwind, CodeMirror; built and served as static assets by the Cloudflare Worker.
- `apps/api`: Hono on Cloudflare Workers; GitHub OAuth/device flow, D1, R2, Queues, and Meta Llama API grading.
- `packages/cli`: Node.js CLI; scans git history, saves a local preview, and syncs only after confirmation.
- `packages/core`: shared evidence contracts and deterministic chain hashing.

## Local development

Requirements: Node.js 20+, npm, Git, and Wrangler.

```sh
npm.cmd install
npm.cmd run dev:api
npm.cmd run dev
```

In another terminal, apply the schema to local D1:

```sh
npm.cmd run db:local -w @attest/api
```

Copy `.dev.vars.example` to `apps/api/.dev.vars` and set `GH_CLIENT_ID`, `GH_CLIENT_SECRET`, `SESSION_SECRET` (a long random value), and `META_LLAMA_API_KEY`. Register a GitHub OAuth app with callback `http://127.0.0.1:8787/api/auth/github/callback` for local browser sign-in. The local Worker command sets `APP_ORIGIN=http://127.0.0.1:5173` automatically. GitHub device flow is used by the CLI. Until OAuth credentials are configured, clicking sign-in explains the missing setup instead of silently sending you to GitHub.

Open `http://localhost:5173`. From the Attest source repository, the CLI commands are:

```sh
.\attest.cmd login
.\attest.cmd scan
.\attest.cmd sync
.\attest.cmd wipe
```

The `.cmd` launcher avoids PowerShell's `npx.ps1` execution-policy error. It defaults to the live Attest Worker; override it with `ATTEST_API_URL` or `--api`. Invoke the launcher by full path from another git repository while keeping that repository as the current directory; the scanner uses the current directory. Do not run `npx attest`: the public npm package name is owned by an unrelated project. This CLI is private until it can be published under an available, owned package scope.

`scan` writes only to `.attest/scan.json`; it does not upload. `sync` prints the complete JSON request, explains that it replaces the previous evidence snapshot, asks for confirmation, and only then uploads it. `wipe` requires a separate confirmation and deletes that account's uploaded evidence, assessments, and R2 artifacts.

## Cloudflare resources and deployment

The Worker config is `apps/api/wrangler.toml`; D1 schema and the initial rubric are in `apps/api/schema.sql`. D1 (`attest-db`) and Queue (`grade-queue`) were created in the connected Cloudflare account. R2 must be enabled for the account in Cloudflare before creating the artifact bucket:

```sh
npx.cmd wrangler r2 bucket create attest-artifacts
```

The D1 ID is already configured. Apply the schema and create the bucket before deploying. The Worker serves the built Vite app and API from one `workers.dev` origin; a separate Pages project and unconfigured `attest.sh` DNS route are not required for the demo.

```sh
npm.cmd run db:remote -w @attest/api
Set-Location apps\api
npx.cmd wrangler r2 bucket create attest-artifacts
npx.cmd wrangler secret put GH_CLIENT_ID
npx.cmd wrangler secret put GH_CLIENT_SECRET
npx.cmd wrangler secret put SESSION_SECRET
npx.cmd wrangler secret put META_LLAMA_API_KEY
```

Use your GitHub OAuth App credentials, a random `SESSION_SECRET`, and your Meta Llama API key. Enter secrets only into Wrangler's secure prompt; never commit them. Llama 3.3 70B generates tests and grades pass one; Llama 4 Scout grades pass two.

Deploy the complete app (API plus static assets) with `npm.cmd run deploy -w @attest/api`. Register the GitHub OAuth callback as `<workers.dev URL>/api/auth/github/callback`, set `ATTEST_API_URL` to that URL in the terminal for CLI use, then test `login`, `scan`, `sync`, and `wipe`.

Publishing the CLI to npm still requires an available owned package scope and npm login. Until then use the Windows `.cmd` launcher rather than `npx attest`.

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

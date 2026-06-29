# Governance Tracking

Node.js + TypeScript backend for monitoring governance forums. The service periodically checks tracked protocol forums, stores new allowlisted proposals, deduplicates repeat sightings, records fetch-run audit data, and optionally sends direct Telegram notifications.

The current tracked protocols are Lido and Aave. There is intentionally no dashboard in this version, and the backend no longer exposes proposal-browsing endpoints for a future UI. Stored proposals live in Firestore in production mode, or in memory during demo/test mode.

For operator commands and expected results, use [PLATFORM_MANUAL.md](/Users/orzsikodon/Projects/governance-tracking/PLATFORM_MANUAL.md).

## Quick Start

Run the monitor locally without Firebase or Telegram:

```bash
npm install
npm run dev
```

In another terminal:

```bash
API=http://localhost:3000
curl -s "$API/health"
curl -s -X POST "$API/api/admin/fetch/lido"
curl -s -X POST "$API/api/admin/fetch/aave"
curl -s "$API/api/admin/fetch-runs"
```

Run the end-to-end terminal walkthrough:

```bash
DEMO_STEP_DELAY_MS=750 npm run demo
```

Run the full local safety check:

```bash
npm run check
```

## Current Scope

- Fetch recent proposal/forum activity for Lido and Aave.
- Validate Discourse JSON responses with Zod.
- Filter fetched items by protocol-specific trusted publisher allowlists.
- Normalize allowlisted items into a common stored proposal shape.
- Deduplicate by `protocol + sourceType + sourceId`.
- Store proposals and fetch runs in Firestore or memory mode.
- Avoid rewriting unchanged proposals on every poll.
- Send direct Telegram notifications for newly discovered allowlisted proposals.
- Avoid duplicate notifications for already-known proposals.
- Run scheduled polling every six hours by default.
- Provide a small operational API for health, manual fetches, notification retries, and fetch-run audit.
- Run deterministic unit/integration tests without live forum calls.
- Run optional real Telegram E2E tests only when explicitly enabled.

## Out Of Scope

- No Angular dashboard.
- No public proposal listing/detail API.
- No CORS/browser-facing API support.
- No debug endpoints.
- No AI agent, AI summary, classification, category tagging, urgency score, recommendation, or portfolio-impact logic.
- No Snapshot or on-chain governance ingestion yet.
- No raw payload archive.

## How It Works

```text
Scheduler or admin fetch request
  -> protocol registry
  -> Lido or Aave adapter
  -> Discourse client
  -> Zod response validation
  -> publisher allowlist filter
  -> normalizer
  -> proposal repository upsert
  -> notification service
  -> fetch-run repository audit record
```

Lido uses the proposal-category Discourse endpoint:

```text
GET https://research.lido.fi/c/proposals/9/l/latest.json?page=<page>
```

`9` is the Lido forum proposal category id. This keeps Lido polling focused on proposal-category topics instead of all latest forum discussion.

Aave uses broader forum coverage because Aave proposal-like activity can appear across multiple public categories and subcategories:

```text
GET https://governance.aave.com/latest.json?page=<page>
GET https://governance.aave.com/site.json
GET https://governance.aave.com/c/<category-path>/<category-id>/l/latest.json?page=<page>
```

The Aave adapter combines global latest pages with discovered public category/subcategory feeds, then deduplicates by Discourse topic id.

## Stored Data

Proposals are stored under `proposals/{proposalId}` in Firestore production mode. Memory mode stores the same shape in-process for demos and tests.

Example proposal:

```json
{
  "id": "lido_forum_11624_445bfbca21",
  "protocol": "lido",
  "sourceType": "forum",
  "sourceId": "11624",
  "title": "Lido Labs proposes Nemo as a new director",
  "publisherName": "Lido Labs Foundation - Operations Team",
  "sourceUrl": "https://research.lido.fi/t/lido-labs-proposes-nemo-as-a-new-director/11624",
  "publishedAt": "2026-06-17T06:59:06.620Z",
  "firstSeenAt": "2026-06-17T07:00:00.000Z",
  "lastSeenAt": "2026-06-17T07:00:00.000Z",
  "fetchedAt": "2026-06-17T07:00:00.000Z",
  "rawHash": "64-character-sha256-hash",
  "notificationStatus": "sent",
  "createdAt": "2026-06-17T07:00:00.000Z",
  "updatedAt": "2026-06-17T07:00:00.000Z"
}
```

`firstSeenAt` is set when the proposal is first stored. `lastSeenAt`, `fetchedAt`, and `updatedAt` advance when a new proposal is inserted or an existing proposal has meaningful source changes. If a repeated poll sees the same proposal with no meaningful changes, the service counts it as `unchangedExistingCount` and does not rewrite the proposal document.

Fetch runs are stored under `fetchRuns/{runId}`:

```json
{
  "protocol": "aave",
  "status": "success",
  "fetchedCount": 120,
  "allowlistedCount": 4,
  "storedNewCount": 1,
  "updatedExistingCount": 0,
  "unchangedExistingCount": 3,
  "skippedCount": 116,
  "notificationSentCount": 1,
  "notificationFailedCount": 0,
  "errors": []
}
```

`storedNewCount` means a proposal was first discovered. `updatedExistingCount` means an already-stored proposal changed in a meaningful source field. `unchangedExistingCount` means the item was seen again but not rewritten. `skippedCount` means the publisher did not match the allowlist.

## Configuration

Create a local `.env` file manually. It is ignored by git.

Common development values:

```bash
NODE_ENV=development
PORT=3000
STORAGE_MODE=memory
DEMO_MODE=true
ENABLE_SCHEDULER=false
API_AUTH_ENABLED=false
LOG_LEVEL=info
```

Production-like values:

```bash
NODE_ENV=production
PORT=3000
STORAGE_MODE=firestore
DEMO_MODE=false
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=0 */6 * * *
API_AUTH_ENABLED=true
API_AUTH_TOKEN=replace-with-long-random-secret
LOG_LEVEL=info
```

Allowed values:

- `NODE_ENV`: `development`, `test`, or `production`.
- `PORT`: integer from `1` to `65535`.
- `STORAGE_MODE`: `firestore` or `memory`.
- `DEMO_MODE`: `true` or `false`.
- `ENABLE_SCHEDULER`: `true` or `false`.
- `API_AUTH_ENABLED`: `true` or `false`.
- `ENABLE_TELEGRAM_NOTIFICATIONS`: `true` or `false`.
- `TELEGRAM_E2E_ENABLED`: `true` or `false`.
- `LOG_LEVEL`: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`.

Firestore mode requires Firebase service account values:

```bash
FIREBASE_PROJECT_ID=replace-with-firebase-project-id
FIREBASE_CLIENT_EMAIL=replace-with-service-account-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace-with-private-key\n-----END PRIVATE KEY-----\n"
```

Lido configuration:

```bash
LIDO_FORUM_BASE_URL=https://research.lido.fi
LIDO_FORUM_API_BASE_URL=https://research.lido.fi
LIDO_ENABLED=true
LIDO_ALLOWED_PUBLISHERS='[
  "Lido Labs Foundation - Operations Team",
  "Lido | Finance Team",
  "Lido Ecosystem Foundation - Operations Team"
]'
LIDO_FETCH_MAX_PAGES=5
```

Aave configuration:

```bash
AAVE_FORUM_BASE_URL=https://governance.aave.com
AAVE_FORUM_API_BASE_URL=https://governance.aave.com
AAVE_ENABLED=true
AAVE_ALLOWED_PUBLISHERS='[
  "AaveLabs",
  "TokenLogic",
  "LlamaRisk"
]'
AAVE_FETCH_MAX_PAGES=10
AAVE_CATEGORY_FETCH_MAX_PAGES=2
```

Telegram direct-user notifications:

```bash
ENABLE_TELEGRAM_NOTIFICATIONS=false
TELEGRAM_BOT_TOKEN=replace-with-telegram-bot-token
TELEGRAM_ALLOWED_USER_IDS='[
  123456789,
  987654321
]'
TELEGRAM_E2E_ENABLED=false
TELEGRAM_TEST_SEND_DELAY_MS=3000
```

Telegram recipients must open the bot and send `/start` once before Telegram allows the bot to message them. The service only sends to numeric IDs listed in `TELEGRAM_ALLOWED_USER_IDS`.

## Commands

Install dependencies:

```bash
npm install
```

Run the API locally:

```bash
npm run dev
```

Run the terminal demo:

```bash
npm run demo
```

Run all normal tests:

```bash
npm test
```

Run full verification:

```bash
npm run check
```

`npm run check` runs the production TypeScript build, strict unused-symbol typecheck, and the full Jest/Supertest test suite.

Run real Telegram test-send:

```bash
npm run telegram:test-send
```

Run real Telegram E2E test:

```bash
npm run test:e2e:telegram
```

The Telegram commands send real messages only when the required Telegram env values are configured. Normal `npm test` and `npm run check` do not send Telegram messages, even if `.env` has `TELEGRAM_E2E_ENABLED=true`; the real E2E test requires the dedicated script.

## Operational API

If `API_AUTH_ENABLED=true`, every endpoint requires the configured token. Use HTTPS in production so the token is not exposed in transit.

Security notes:

- Keep `.env` and `.env.*` files out of git and Docker images.
- Use a long random `API_AUTH_TOKEN` when the API is reachable outside your machine.
- Request logs redact `Authorization`, `x-api-token`, Telegram, Firebase, and API token fields.

| Endpoint | Calls forums? | Purpose |
| --- | --- | --- |
| `GET /health` | No | Confirms service health and storage/scheduler mode. |
| `POST /api/admin/fetch/lido` | Yes | Fetches Lido proposal-category topics, filters, stores, notifies, and writes a fetch run. |
| `POST /api/admin/fetch/aave` | Yes | Fetches Aave global latest plus public category/subcategory feeds, filters, stores, notifies, and writes a fetch run. |
| `POST /api/admin/notify-pending` | No | Retries proposals currently marked `pending`. |
| `GET /api/admin/fetch-runs` | No | Returns latest stored fetch-run audit records, newest first. |

With auth enabled, include a token:

```bash
curl -s http://localhost:3000/health \
  -H "Authorization: Bearer $API_AUTH_TOKEN"
```

You can also use `x-api-token: $API_AUTH_TOKEN`.

## Demo Mode

`npm run demo` runs a credential-free terminal walkthrough using memory storage and locally saved governance payload samples. It exercises the same fetch, allowlist, dedupe, storage, fetch-run, and notification code paths as normal operation.

Demo mode shows:

- New allowlisted Lido items being discovered over multiple fetches.
- Non-allowlisted Lido items being skipped.
- Aave global latest plus category/subcategory coverage.
- Repeat fetches updating counts without duplicating proposals.
- Stored proposals printed from the repository.
- Fetch-run audit records printed from the repository.
- Pending notification retry behavior.

Speed it up:

```bash
DEMO_STEP_DELAY_MS=0 npm run demo
```

If Telegram is enabled in `.env`, the demo can send real direct-user Telegram notifications during the new-proposal fetches.

## Docker

Development compose:

```bash
docker compose up --build
```

Credential-free demo API container:

```bash
docker compose -f docker-compose.demo.yml up --build
```

Production image:

```bash
docker build -t governance-tracking-backend .
docker run --env-file .env -p 3000:3000 governance-tracking-backend
```

Secrets are injected through environment variables and are not baked into the Docker image.

## Adding Another Protocol

Add a protocol adapter under `src/protocols/<protocol>/`, including a forum/source client, Zod schemas, normalizer, fixtures, and tests. Register the adapter in `src/protocols/registry.ts`. The shared fetch job, repositories, notification service, scheduler, and admin fetch endpoint are protocol-agnostic.

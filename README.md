# Governance Tracking

Node.js + TypeScript backend for monitoring governance forums. The service periodically checks tracked protocol forums, stores new allowlisted proposals, tracks raw forum-source freshness, deduplicates repeat sightings, records fetch-run audit data, and optionally sends direct Telegram notifications.

The current tracked protocols are Lido, Aave, and Uniswap. There is intentionally no dashboard in this version, and the backend no longer exposes proposal-browsing endpoints for a future UI. Stored proposals live in Firestore in production mode, or in memory during demo/test mode.

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
curl -s -X POST "$API/api/admin/fetch/uniswap"
curl -s "$API/api/admin/fetch-runs"
curl -s "$API/api/admin/source-activity"
```

Run the end-to-end terminal walkthrough:

```bash
DEMO_STEP_DELAY_MS=750 npm run demo
```

Run the walkthrough and send the final operator status report to the configured Telegram admin:

```bash
DEMO_STEP_DELAY_MS=750 npm run demo:admin
```

Run the full local safety check:

```bash
npm run check
```

## Production Preflight

Before pointing the monitor at production Firestore/Telegram, run:

```bash
npm run check
DEMO_STEP_DELAY_MS=0 npm run demo
docker build -t governance-tracker-bot .
```

Then start the production-like service and verify:

```bash
API=http://localhost:3000
curl -s "$API/health" -H "Authorization: Bearer $API_AUTH_TOKEN"
curl -s -X POST "$API/api/admin/fetch/lido" -H "Authorization: Bearer $API_AUTH_TOKEN"
curl -s -X POST "$API/api/admin/fetch/aave" -H "Authorization: Bearer $API_AUTH_TOKEN"
curl -s -X POST "$API/api/admin/fetch/uniswap" -H "Authorization: Bearer $API_AUTH_TOKEN"
curl -s "$API/api/admin/fetch-runs" -H "Authorization: Bearer $API_AUTH_TOKEN"
curl -s "$API/api/admin/source-activity" -H "Authorization: Bearer $API_AUTH_TOKEN"
```

Expected result: all three manual fetches finish with `status: "success"` in their `run`, fetch-run records are created, source-activity records exist for Lido, Aave, and Uniswap, and any Telegram failures are visible in `notificationFailedCount` and the daily admin status report.

Production deployment note: if you run multiple backend replicas, prefer enabling `ENABLE_SCHEDULER=true` on only one worker. Firestore proposal upserts are transaction-backed to protect against duplicate proposal records and duplicate new-proposal notifications, but multiple active schedulers can still create duplicate polling load and extra fetch-run audit records.

## Current Scope

- Fetch recent proposal/forum activity for Lido, Aave, and Uniswap.
- Validate Discourse JSON responses with Zod.
- Filter fetched items by protocol-specific trusted publisher allowlists.
- Normalize allowlisted items into a common stored proposal shape.
- Deduplicate by `protocol + sourceType + sourceId`.
- Store proposals and fetch runs in Firestore or memory mode.
- Track raw source activity so silent forum migrations or abandoned feeds surface.
- Avoid rewriting unchanged proposals on every poll.
- Send direct Telegram notifications for newly discovered allowlisted proposals.
- Avoid duplicate notifications for already-known proposals.
- Send a daily Telegram status report to the configured admin when enabled.
- Run scheduled polling once daily by default.
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
  -> Lido, Aave, or Uniswap adapter
  -> Discourse client
  -> Zod response validation
  -> source-activity watchdog update
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

Aave and Uniswap use broader forum coverage because proposal-like activity can appear across multiple public categories and subcategories:

```text
GET https://governance.aave.com/latest.json?page=<page>
GET https://governance.aave.com/site.json
GET https://governance.aave.com/c/<category-path>/<category-id>/l/latest.json?page=<page>

GET https://gov.uniswap.org/latest.json?page=<page>
GET https://gov.uniswap.org/site.json
GET https://gov.uniswap.org/c/<category-path>/<category-id>/l/latest.json?page=<page>
```

The Aave and Uniswap adapters combine global latest pages with discovered public category/subcategory feeds, then deduplicate by Discourse topic id. For Uniswap, that currently covers public categories discovered from `/site.json`, such as Temperature Check, Requests for Comment, Consensus Check, Delegation Pitch, Governance-Meta, and Service Providers. Private/read-restricted categories are ignored because the public API does not expose them without forum permissions.

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

Source activity records are stored under `sourceActivity/{protocol}`. These records are based on all raw fetched forum items, before publisher allowlist filtering, so they can detect a forum that still responds but appears abandoned or silently migrated.

Example source activity record:

```json
{
  "protocol": "aave",
  "sourceType": "forum",
  "latestRawSourceId": "25170",
  "latestRawPublishedAt": "2026-07-01T00:00:00.000Z",
  "lastFetchedAt": "2026-07-02T00:00:00.000Z",
  "lastFetchedCount": 120,
  "consecutiveStaleRuns": 0,
  "status": "healthy",
  "warningThresholdDays": 14,
  "criticalThresholdDays": 30,
  "minFetchedCount": 1,
  "updatedAt": "2026-07-02T00:00:00.000Z"
}
```

If the newest raw item becomes older than the configured threshold, or a fetch unexpectedly returns too few raw items, the daily admin status report marks the source as warning or critical.

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
FETCH_INTERVAL_CRON=0 8 * * *
ENABLE_SOURCE_ACTIVITY_ALERTS=true
SOURCE_ACTIVITY_WARNING_DAYS=14
SOURCE_ACTIVITY_CRITICAL_DAYS=30
SOURCE_ACTIVITY_MIN_FETCHED_COUNT=1
ENABLE_ADMIN_STATUS_REPORTS=true
TELEGRAM_ADMIN_USER_ID=1549323073
ADMIN_STATUS_CRON=0 9 * * *
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
- `ENABLE_SOURCE_ACTIVITY_ALERTS`: `true` or `false`.
- `SOURCE_ACTIVITY_WARNING_DAYS`: positive integer; warns when newest raw forum item is at least this old.
- `SOURCE_ACTIVITY_CRITICAL_DAYS`: positive integer greater than or equal to warning days.
- `SOURCE_ACTIVITY_MIN_FETCHED_COUNT`: non-negative integer; marks source critical if a fetch returns fewer raw items.
- `API_AUTH_ENABLED`: `true` or `false`.
- `ENABLE_TELEGRAM_NOTIFICATIONS`: `true` or `false`.
- `ENABLE_ADMIN_STATUS_REPORTS`: `true` or `false`.
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
  "LlamaRisk",
  "TokenLogic",
  "Certora",
  "kpk",
  "karpatkey_TokenLogic",
  "AaveLabs",
  "stani"
]'
AAVE_FETCH_MAX_PAGES=10
AAVE_CATEGORY_FETCH_MAX_PAGES=2
```

Aave allowlist entries should use Discourse publisher usernames. The current tracked names correspond to LlamaRisk, TokenLogic, Certora, karpatkey, Aave Labs, and Stani. `karpatkey_TokenLogic` is included because Aave has used that joint provider account for finance-service-provider posts.

Uniswap configuration:

```bash
UNISWAP_FORUM_BASE_URL=https://gov.uniswap.org
UNISWAP_FORUM_API_BASE_URL=https://gov.uniswap.org
UNISWAP_ENABLED=true
UNISWAP_ALLOWED_PUBLISHERS='[
  "haydenadams",
  "eek637",
  "devinwalsh",
  "kenneth",
  "nataliara",
  "GFXlabs",
  "UniswapFoundation"
]'
UNISWAP_FETCH_MAX_PAGES=10
UNISWAP_CATEGORY_FETCH_MAX_PAGES=2
```

Uniswap allowlist entries should use stable Discourse profile usernames. The monitor also checks the raw Discourse username behind a displayed publisher name, so profiles like `devinwalsh` can be tracked even when the stored proposal publisher displays as `Devin`.

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

Telegram admin status reports:

```bash
ENABLE_ADMIN_STATUS_REPORTS=true
TELEGRAM_ADMIN_USER_ID=1549323073
ADMIN_STATUS_CRON=0 9 * * *
```

Admin status reports use the same `TELEGRAM_BOT_TOKEN`, but they are separate from proposal notification recipients. When `ENABLE_SCHEDULER=true`, protocol fetches run daily at `08:00` server time by default, then the admin receives one daily status message at `09:00` server time. The one-hour gap gives the report time to include the latest daily fetch outcome. The message reports storage mode, scheduler mode, enabled protocols, latest fetch status per protocol, pending/failed notification counts, and recent problems.

Source activity watchdog:

```bash
ENABLE_SOURCE_ACTIVITY_ALERTS=true
SOURCE_ACTIVITY_WARNING_DAYS=14
SOURCE_ACTIVITY_CRITICAL_DAYS=30
SOURCE_ACTIVITY_MIN_FETCHED_COUNT=1
```

This watchdog looks at all raw fetched forum topics, not just allowlisted publishers. It helps catch silent forum migrations, abandoned category feeds, and old forums that still return valid JSON but no longer receive new governance activity.

For a one-off demo, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_USER_ID`, then run `npm run demo:admin`. That command uses memory storage and local forum samples, performs the normal monitor demo, and sends the final status report to the admin user only. Plain `npm run demo` keeps the admin status demo off even if production admin reports are enabled in `.env`.

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

Run the terminal demo with the final admin status Telegram report:

```bash
npm run demo:admin
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
| `POST /api/admin/fetch/uniswap` | Yes | Fetches Uniswap global latest plus public category/subcategory feeds, filters, stores, notifies, and writes a fetch run. |
| `POST /api/admin/notify-pending` | No | Retries proposals currently marked `pending`. |
| `GET /api/admin/fetch-runs` | No | Returns latest stored fetch-run audit records, newest first. |
| `GET /api/admin/source-activity` | No | Returns latest raw-source freshness records used by the silent-migration watchdog. |

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
- Uniswap global latest plus all discovered public category/subcategory coverage.
- Repeat fetches updating counts without duplicating proposals.
- Stored proposals printed from the repository.
- Fetch-run audit records printed from the repository.
- Source-activity watchdog records printed from the repository.
- Pending notification retry behavior.

Speed it up:

```bash
DEMO_STEP_DELAY_MS=0 npm run demo
```

If Telegram is enabled in `.env`, the demo can send real direct-user Telegram notifications during the new-proposal fetches.

## Docker

Production image:

```bash
docker build -t governance-tracker-bot .
```

Production container with runtime environment variables:

```bash
docker run -d \
  -p 3000:3000 \
  --name governance-tracker-bot \
  --restart unless-stopped \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e STORAGE_MODE=firestore \
  -e DEMO_MODE=false \
  -e ENABLE_SCHEDULER=true \
  -e FETCH_INTERVAL_CRON="0 8 * * *" \
  -e ENABLE_SOURCE_ACTIVITY_ALERTS=true \
  -e SOURCE_ACTIVITY_WARNING_DAYS=14 \
  -e SOURCE_ACTIVITY_CRITICAL_DAYS=30 \
  -e SOURCE_ACTIVITY_MIN_FETCHED_COUNT=1 \
  -e API_AUTH_ENABLED=true \
  -e API_AUTH_TOKEN="replace-with-long-random-secret" \
  -e FIREBASE_PROJECT_ID="replace-with-project-id" \
  -e FIREBASE_CLIENT_EMAIL="replace-with-client-email" \
  -e FIREBASE_PRIVATE_KEY="replace-with-private-key" \
  -e ENABLE_TELEGRAM_NOTIFICATIONS=true \
  -e TELEGRAM_BOT_TOKEN="replace-with-telegram-bot-token" \
  -e TELEGRAM_ALLOWED_USER_IDS='["1549323073"]' \
  -e ENABLE_ADMIN_STATUS_REPORTS=true \
  -e TELEGRAM_ADMIN_USER_ID="1549323073" \
  -e ADMIN_STATUS_CRON="0 9 * * *" \
  -e LIDO_ENABLED=true \
  -e AAVE_ENABLED=true \
  -e UNISWAP_ENABLED=true \
  -e LOG_LEVEL=info \
  governance-tracker-bot
```

Add the protocol allowlists with `-e LIDO_ALLOWED_PUBLISHERS='[...]'`, `-e AAVE_ALLOWED_PUBLISHERS='[...]'`, and `-e UNISWAP_ALLOWED_PUBLISHERS='[...]'` if they are not already provided by the deployment environment.

For `FIREBASE_PRIVATE_KEY`, pass the same escaped newline format used in `.env`, for example `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n`. If quoting this directly in the shell becomes annoying, using Docker's `--env-file .env` flag is less error-prone, but production does not require Docker Compose.

Useful Docker commands:

```bash
docker ps -a
docker images
docker build -t governance-tracker-bot .
docker run -d -p 3000:3000 --name governance-tracker-bot --restart unless-stopped [env vars...] governance-tracker-bot
docker logs -f governance-tracker-bot
docker stop governance-tracker-bot
docker rm governance-tracker-bot
docker restart governance-tracker-bot
```

To replace a running container after rebuilding:

```bash
docker stop governance-tracker-bot
docker rm governance-tracker-bot
docker build -t governance-tracker-bot .
docker run -d -p 3000:3000 --name governance-tracker-bot --restart unless-stopped [env vars...] governance-tracker-bot
```

Secrets are injected through environment variables and are not baked into the Docker image. Do not commit `.env` files or paste real secrets into shell history unless you are comfortable rotating them later.

## Adding Another Protocol

Add a protocol adapter under `src/protocols/<protocol>/`, including a forum/source client, Zod schemas, normalizer, fixtures, and tests. Register the adapter in `src/protocols/registry.ts`. The shared fetch job, repositories, notification service, scheduler, and admin fetch endpoint are protocol-agnostic.

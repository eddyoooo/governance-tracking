# Governance Tracking

Backend MVP for tracking governance activity. The current system tracks Lido forum proposals, keeps only items from trusted publishers, deduplicates them, stores normalized proposal records, records fetch runs, and can optionally notify Telegram when a new trusted proposal appears.

For exact commands and expected terminal/API results, use [PLATFORM_MANUAL.md](/Users/orzsikodon/Projects/governance-tracking/PLATFORM_MANUAL.md).

## What It Does

The platform fetches recent Lido governance topics from `https://research.lido.fi`, validates the Discourse JSON response, extracts each topic's `publisherName`, and compares that publisher against `LIDO_ALLOWED_PUBLISHERS`. Only allowlisted topics are stored as governance proposals.

For Lido, the backend intentionally calls the category-specific Discourse endpoint:

```text
GET /c/proposals/9/l/latest.json?page=<page>
```

`proposals` is the category slug and `9` is the Lido forum category id for proposal topics. This is used instead of the forum-wide `GET /latest.json` endpoint because the product goal is to track governance proposals, not every latest forum discussion.

The endpoint currently returns 30 proposal-category topics per page. The backend paginates up to `LIDO_FETCH_MAX_PAGES` pages and stops early once an allowlisted page is entirely already known.

The Lido proposal category also exposes an RSS feed at `/c/proposals/9.rss`; the current implementation still uses the JSON polling path because it gives us structured pagination and topic metadata.

Stored proposals are deduplicated by:

```text
protocol + sourceType + sourceId
```

For Lido, that means:

```text
lido + forum + <discourse-topic-id>
```

If the same proposal appears again in a later fetch, the backend does not create a duplicate. If source content changed, it updates the existing record. If the source content is identical except for fetch timestamps, it skips rewriting the proposal and records that repeat sighting in the fetch-run `unchangedExistingCount`.

## Current Capabilities

- Fetch Lido forum governance topics.
- Paginate Lido proposal-category pages for better notification coverage.
- Stop pagination once it reaches already-known allowlisted proposal pages.
- Validate external Lido responses with Zod.
- Filter proposals by trusted publisher allowlist.
- Store normalized proposal records in Firestore or memory mode.
- Deduplicate proposals across repeated fetches.
- Skip unnecessary proposal writes when a repeat poll only changes fetch timestamps.
- Track `firstSeenAt`, `createdAt`, and `updatedAt` on stored proposal records.
- Track proposal notification state: `pending`, `sent`, `skipped`, or `failed`.
- Record fetch-run metadata with fetched, allowlisted, stored, updated, unchanged, skipped, and notification counts.
- Optionally send Telegram notifications for new allowlisted proposals.
- Expose Express API endpoints for proposals, protocols, fetch runs, admin fetches, and debug/demo utilities.
- Run a guided terminal demo in memory mode with scripted Lido proposal discovery.
- Run scheduled polling every 15 minutes in normal mode.
- Run with Docker and docker-compose.
- Run deterministic Jest/Supertest tests without live network dependency.

## Out Of Scope

This step intentionally does not include AI summaries, agents, classification, category tagging, urgency scoring, recommended actions, portfolio impact logic, Snapshot ingestion, on-chain governance ingestion, non-Lido protocol adapters, or an Angular dashboard.

Firebase Storage is not used. Firestore is the structured database in normal operation.

## Architecture

```text
Lido Discourse JSON or demo fixture
  -> LidoForumClient
  -> LidoAdapter
  -> publisher allowlist filter
  -> normalizer
  -> fetch job
  -> proposal + fetch-run repositories
  -> Firestore or memory storage
  -> Express API
```

Important folders:

- `src/protocols`: protocol interfaces, registry, allowlist logic, Lido adapter/client/normalizer.
- `src/jobs`: fetch/filter/normalize/upsert/notify business logic.
- `src/storage`: Firestore and memory repositories.
- `src/notifications`: Noop and Telegram notification services.
- `src/api/routes`: health, proposal, protocol, admin, and debug routes.
- `tests`: unit, fixture, and integration coverage.

## Stored Data

Proposal records include source data and platform tracking metadata:

```json
{
  "id": "lido_forum_11415_abc123def0",
  "protocol": "lido",
  "sourceType": "forum",
  "sourceId": "11415",
  "title": "Example Lido Proposal",
  "publisherName": "Example Publisher",
  "sourceUrl": "https://research.lido.fi/t/example/11415",
  "publishedAt": "2026-06-05T09:00:00.000Z",
  "firstSeenAt": "2026-06-05T10:00:00.000Z",
  "fetchedAt": "2026-06-05T10:00:00.000Z",
  "rawHash": "64-character-sha256-hash",
  "notificationStatus": "skipped",
  "createdAt": "2026-06-05T10:00:00.000Z",
  "updatedAt": "2026-06-05T10:00:00.000Z"
}
```

Fetch-run records explain what happened during each fetch:

```json
{
  "protocol": "lido",
  "status": "success",
  "fetchedCount": 30,
  "allowlistedCount": 4,
  "storedNewCount": 2,
  "updatedExistingCount": 1,
  "unchangedExistingCount": 1,
  "skippedCount": 26,
  "notificationSentCount": 2,
  "notificationFailedCount": 0,
  "errors": []
}
```

`updatedExistingCount` means an already-stored proposal changed in a meaningful source field such as title, publisher, URL, published time, or raw payload hash. `unchangedExistingCount` means the proposal was seen again but the stored record was identical, so the backend skipped the write.

Firestore collections:

- `proposals/{proposalId}`
- `fetchRuns/{runId}`

## Configuration Summary

Create a local `.env` file directly. It is ignored by git.

Core local/demo values:

```bash
NODE_ENV=development
PORT=3000
STORAGE_MODE=memory
DEMO_MODE=true
ENABLE_SCHEDULER=false
ENABLE_DEBUG_ENDPOINTS=true
API_AUTH_ENABLED=false
```

Core production-like values:

```bash
NODE_ENV=production
STORAGE_MODE=firestore
DEMO_MODE=false
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=*/15 * * * *
ENABLE_DEBUG_ENDPOINTS=false
API_AUTH_ENABLED=true
API_AUTH_TOKEN=replace-with-long-random-secret
```

Firestore mode requires:

```bash
FIREBASE_PROJECT_ID=replace-with-firebase-project-id
FIREBASE_CLIENT_EMAIL=replace-with-service-account-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace-with-service-account-private-key\n-----END PRIVATE KEY-----\n"
```

Lido allowlist should use JSON array format:

```bash
LIDO_ALLOWED_PUBLISHERS='[
  "Lido Labs Foundation - Operations Team",
  "Lido | Finance Team",
  "Lido Ecosystem Foundation - Operations Team"
]'
LIDO_FETCH_MAX_PAGES=5
```

Telegram is optional and sends direct messages only to explicitly allowlisted
Telegram user IDs. Each user must open the bot and send `/start` once before
Telegram allows the bot to message them.

```bash
ENABLE_TELEGRAM_NOTIFICATIONS=false
TELEGRAM_BOT_TOKEN=replace-with-telegram-bot-token
TELEGRAM_ALLOWED_USER_IDS='[
  123456789,
  987654321
]'
TELEGRAM_E2E_ENABLED=true
TELEGRAM_TEST_SEND_DELAY_MS=3000
```

## Development

Common commands:

```bash
npm install
npm run dev
npm run demo
npm run telegram:test-send
npm test
npm run test:e2e:telegram
npm run check
```

`npm run demo` runs a terminal walkthrough using scripted Lido proposal fixtures and in-memory storage. It reveals three new allowlisted proposals one by one, runs the normal fetch/store/notify logic after each reveal, exercises the API endpoints, and can be sped up with `DEMO_STEP_DELAY_MS=0 npm run demo`. The fixture set also includes one real non-allowlisted Lido proposal, shown as `skippedPublisherFixture`, to prove the platform fetches it but does not store or notify it. If Telegram is enabled in `.env`, this complete demo sends the proposal notifications through Telegram.

`npm run telegram:test-send` sends real Lido proposal test alerts from different
publishers to the configured `TELEGRAM_ALLOWED_USER_IDS`. `npm run test:e2e:telegram`
runs the real Telegram E2E test and sends the same fixture-backed proposal set
through the pending-notification flow. Both commands use
`src/demoFixtures/telegramNotification.fixture.ts`. The manual test-send command
waits `3000ms` between proposal messages by default; use
`TELEGRAM_TEST_SEND_DELAY_MS=0 npm run telegram:test-send` for a fast run. Telegram
messages start with a bold all-caps `NEW GOVERNANCE ITEM TRACKED` header.

Use [PLATFORM_MANUAL.md](/Users/orzsikodon/Projects/governance-tracking/PLATFORM_MANUAL.md) for the full capability checklist, curl commands, Docker commands, expected results, demo walkthrough, and explanation of common fetch counts such as `skippedCount` and `unchangedExistingCount`.

## Adding Another Protocol Later

Add a new adapter under `src/protocols/<protocol>/` with a source client, Zod response schemas, normalizer, adapter, fixtures, and tests. Register it in `src/protocols/registry.ts`. The shared fetch job and repositories should remain protocol-agnostic.

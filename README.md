# Governance Tracking

Node.js + TypeScript backend MVP for tracking governance activity across protocols. Step 2 tracks Lido forum activity, filters it by trusted publishers, deduplicates proposals, stores normalized records, records fetch runs, and can optionally notify Telegram when a new allowlisted proposal appears.

For a compact terminal-only reference, see [PLATFORM_MANUAL.md](/Users/orzsikodon/Projects/governance-tracking/PLATFORM_MANUAL.md).

## Current Scope

The backend currently can:

- Fetch recent Lido governance topics from the Discourse JSON API.
- Validate Lido API responses with Zod.
- Resolve each topic's `publisherName`.
- Filter by `LIDO_ALLOWED_PUBLISHERS`.
- Normalize allowlisted items into internal proposal records.
- Deduplicate by `protocol + sourceType + sourceId`.
- Track `firstSeenAt`, `lastSeenAt`, `createdAt`, and `updatedAt`.
- Store proposals and fetch runs in Firestore, or in memory for demo/tests.
- Track notification status on proposals.
- Optionally send Telegram notifications for newly discovered allowlisted proposals.
- Expose storage-backed APIs for proposals, protocols, and fetch runs.
- Expose debug endpoints that can be disabled.
- Run scheduled fetches every 6 hours by default in normal mode.
- Run fixture-backed demos without Firebase or Telegram credentials.
- Run with Docker and docker-compose.
- Run a deterministic Jest/Supertest test suite with no live network dependency.

Intentionally out of scope:

- AI agents, summaries, classification, category tagging, urgency scoring, recommendations, portfolio impact, or position-impact logic.
- Snapshot, on-chain governance, Aave, Pendle, Uniswap, or other adapters.
- Angular dashboard implementation.
- Firebase Storage. This project uses Firestore for structured application state.

## Architecture

```text
Lido Discourse JSON or demo fixture
  -> LidoForumClient
  -> LidoAdapter
  -> publisher allowlist filter
  -> normalizer
  -> fetch job business logic
  -> ProposalRepository / FetchRunRepository
  -> Firestore or memory storage
  -> Express API
```

Important source areas:

- `src/server.ts`: Express app factory, middleware, routes, dependency wiring.
- `src/config/env.ts`: env parsing, defaults, safe config output.
- `src/protocols/*`: protocol interfaces, registry, allowlist logic, Lido adapter/client/normalizer.
- `src/jobs/fetchProtocolGovernance.job.ts`: fetch, filter, normalize, upsert, notify, fetch-run recording.
- `src/notifications/*`: Noop and Telegram notification services.
- `src/storage/*`: Firestore and memory repositories.
- `src/api/routes/*`: health, proposals, protocols, admin, and debug routes.
- `src/demo.ts`: one-shot fixture-backed demo.
- `tests/*`: unit, fixture, and integration coverage.

## Data Model

Stored proposal shape:

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
  "lastSeenAt": "2026-06-05T10:00:00.000Z",
  "fetchedAt": "2026-06-05T10:00:00.000Z",
  "rawHash": "64-character-sha256-hash",
  "status": "new",
  "notificationStatus": "skipped",
  "createdAt": "2026-06-05T10:00:00.000Z",
  "updatedAt": "2026-06-05T10:00:00.000Z"
}
```

`id` is the internal deterministic id used by `GET /api/proposals/:id`. `sourceId` is the upstream Lido/Discourse topic id, so topic `11415` is read with `GET /api/proposals/source/lido/forum/11415` unless you already know the internal id.

Fetch run shape:

```json
{
  "id": "fetchRun_lido_abc123def456",
  "protocol": "lido",
  "startedAt": "2026-06-05T10:00:00.000Z",
  "finishedAt": "2026-06-05T10:00:01.000Z",
  "status": "success",
  "fetchedCount": 30,
  "allowlistedCount": 4,
  "storedNewCount": 2,
  "updatedExistingCount": 2,
  "skippedCount": 26,
  "notificationPendingCount": 2,
  "notificationSentCount": 2,
  "notificationFailedCount": 0,
  "errors": []
}
```

Firestore collections:

- `proposals/{proposalId}`
- `fetchRuns/{runId}`

The app uses the default Firestore database.

## Environment

Create a local `.env` file directly.

Development/demo values:

```bash
NODE_ENV=development
PORT=3000
STORAGE_MODE=memory
DEMO_MODE=true
ENABLE_SCHEDULER=false
ENABLE_DEBUG_ENDPOINTS=true
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
ENABLE_DEBUG_ENDPOINTS=false
API_AUTH_ENABLED=true
API_AUTH_TOKEN=replace-with-long-random-secret
LOG_LEVEL=info
```

Allowed values:

- `NODE_ENV`: `development`, `test`, `production`
- `STORAGE_MODE`: `firestore`, `memory`
- Boolean values: `true` or `false`
- `FETCH_INTERVAL_CRON`: cron expression, default `0 */6 * * *`

Firebase values for Firestore mode:

```bash
FIREBASE_PROJECT_ID=replace-with-firebase-project-id
FIREBASE_CLIENT_EMAIL=replace-with-service-account-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace-with-service-account-private-key\n-----END PRIVATE KEY-----\n"
```

Notes:

- `FIREBASE_PRIVATE_KEY` can use escaped newlines as `\n`.
- Firebase Storage is not required or used.
- `.env` is ignored by git. Do not commit credentials or API tokens.

Lido values:

```bash
LIDO_FORUM_BASE_URL=https://research.lido.fi
LIDO_FORUM_API_BASE_URL=https://research.lido.fi
LIDO_ENABLED=true
LIDO_ALLOWED_PUBLISHERS='[
  "Lido Labs Foundation - Operations Team",
  "Lido | Finance Team",
  "Lido Ecosystem Foundation - Operations Team"
]'
```

`LIDO_ALLOWED_PUBLISHERS` should be a JSON array. Legacy comma-separated values still work. Matching is trimmed, case-insensitive, punctuation-normalized, and conservatively typo-tolerant.

Telegram values:

```bash
ENABLE_TELEGRAM_NOTIFICATIONS=false
TELEGRAM_BOT_TOKEN=replace-with-telegram-bot-token
TELEGRAM_CHAT_ID=replace-with-telegram-chat-id
NOTIFY_ON_NEW_PROPOSAL=true
```

If Telegram is disabled, new proposals get `notificationStatus=skipped`. If Telegram is enabled and `NOTIFY_ON_NEW_PROPOSAL=true`, new allowlisted proposals are marked `pending`, sent, then updated to `sent` or `failed`.

API auth values:

```bash
API_AUTH_ENABLED=true
API_AUTH_TOKEN=replace-with-long-random-secret
```

When enabled, every endpoint requires either `Authorization: Bearer <token>` or `x-api-token: <token>`.

## Run Locally

Install and start:

```bash
npm install
npm run dev
```

Build and run compiled output:

```bash
npm run build
npm run start
```

Run the one-shot fixture demo:

```bash
npm run demo
```

Run the fixture-backed API demo:

```bash
STORAGE_MODE=memory DEMO_MODE=true ENABLE_DEBUG_ENDPOINTS=true ENABLE_SCHEDULER=false npm run demo:api
```

In memory/demo mode, data is stored inside the running Node.js process only. Restarting the process clears it.

## API

Storage-backed endpoints do not call Lido:

| Method | Route | Expected return |
| --- | --- | --- |
| `GET` | `/` | Service name and route list. |
| `GET` | `/health` | `{ ok, storageMode, schedulerEnabled }`. |
| `GET` | `/api/protocols` | Registered protocol adapters and source metadata. |
| `GET` | `/api/proposals` | Stored proposals from memory or Firestore. |
| `GET` | `/api/proposals/:id` | One stored proposal by internal id. |
| `GET` | `/api/proposals/source/:protocol/:sourceType/:sourceId` | One stored proposal by source identity. |
| `GET` | `/api/admin/fetch-runs` | Stored fetch runs from memory or Firestore. |

Fetch/debug endpoints call the registered Lido adapter. In memory/demo mode, that adapter uses fixtures. In normal Firestore mode, it calls Lido/Discourse.

| Method | Route | Expected return |
| --- | --- | --- |
| `POST` | `/api/admin/fetch/:protocol` | Fetch-run result after fetching, filtering, upserting, and optional notification. |
| `POST` | `/api/admin/notify-pending` | Counts for pending notifications attempted. |
| `GET` | `/api/debug/config-safe` | Non-secret runtime config. Debug only. |
| `GET` | `/api/debug/lido/recent` | Recent raw Lido adapter items; does not store. Debug only. |
| `POST` | `/api/debug/lido/fetch-once` | Same fetch/store behavior as admin fetch. Debug only. |
| `GET` | `/api/debug/demo-fixtures` | Demo fixture payloads. Debug only. |
| `POST` | `/api/debug/reset-demo-state` | Clears memory repositories. Debug and memory/demo only. |

Proposal list query params:

```text
protocol
publisherName
sourceType=forum|snapshot|onchain
notificationStatus=pending|sent|skipped|failed
limit=1..100
offset=0..
sort=publishedAt_desc|publishedAt_asc|firstSeenAt_desc|firstSeenAt_asc|lastSeenAt_desc|lastSeenAt_asc
```

Example commands:

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/api/protocols
curl -s -X POST http://localhost:3000/api/admin/fetch/lido
curl -s "http://localhost:3000/api/proposals?protocol=lido&limit=5"
curl -s http://localhost:3000/api/proposals/source/lido/forum/11415
curl -s http://localhost:3000/api/admin/fetch-runs
curl -s -X POST http://localhost:3000/api/admin/notify-pending
```

With auth enabled:

```bash
curl -s http://localhost:3000/health \
  -H "Authorization: Bearer $API_AUTH_TOKEN"
```

## Scheduler

Normal scheduled fetching:

```bash
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=0 */6 * * *
```

The cron job runs the same logic as `POST /api/admin/fetch/lido`: fetch, allowlist-filter, dedupe/upsert, optionally notify, and record a fetch run. Overlapping runs for the same protocol are blocked.

In memory/demo mode, scheduler defaults to disabled unless `ENABLE_SCHEDULER=true` is explicitly set.

## Tests

Run all tests:

```bash
npm test
```

Run build plus all tests:

```bash
npm run check
```

Run watch mode:

```bash
npm run test:watch
```

The suite covers env parsing, safe config, Firebase config validation, allowlists, response validation, normalization, deterministic ids/hashes, memory and mocked Firestore repositories, proposal upsert semantics, fetch-run listing, fetch job counts, duplicate handling, notification success/failure/no-duplicate behavior, admin auth, debug gating, proposal query params, scheduler behavior, and demo-mode assumptions. Tests use fixtures/mocks and do not rely on live network calls.

## Docker

Development compose:

```bash
docker compose up --build
```

Credential-free API demo:

```bash
docker compose -f docker-compose.demo.yml up --build
```

Production image:

```bash
docker build -t governance-tracking-backend .
docker run --env-file .env -p 3000:3000 governance-tracking-backend
```

Secrets are injected at runtime. They are not baked into the image.

## Troubleshooting

Fetch succeeds but no proposals are stored:

The fetched `publisherName` values did not match `LIDO_ALLOWED_PUBLISHERS`. Enable debug endpoints, inspect `/api/debug/lido/recent`, update the allowlist, restart, and fetch again.

`/api/proposals/11415` returns `Proposal not found`:

`11415` is a source id, not the internal proposal id. Use `/api/proposals/source/lido/forum/11415` or list proposals and copy the internal `id`.

Debug endpoints return `404`:

Set `ENABLE_DEBUG_ENDPOINTS=true` and restart.

Every endpoint returns `401`:

`API_AUTH_ENABLED=true`; send the configured token.

Firestore startup fails:

Check `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. Firebase Storage is not needed.

Telegram startup fails:

If `ENABLE_TELEGRAM_NOTIFICATIONS=true`, both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` must be set.

## Adding Another Protocol Later

Add a folder under `src/protocols/<protocol>/` with a source client, Zod response schemas, normalizer, adapter, fixtures, and tests. Register the adapter in `src/protocols/registry.ts`. The shared fetch job and repositories should not need protocol-specific branching for normal forum-like sources.

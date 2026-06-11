# Governance Tracking

Backend MVP for tracking governance activity. The current system tracks Lido forum proposals, keeps only items from trusted publishers, deduplicates them, stores normalized proposal records, records fetch runs, and can optionally notify Telegram when a new trusted proposal appears.

For exact commands and expected terminal/API results, use [PLATFORM_MANUAL.md](/Users/orzsikodon/Projects/governance-tracking/PLATFORM_MANUAL.md).

## What It Does

The platform fetches recent Lido governance topics from `https://research.lido.fi`, validates the Discourse JSON response, extracts each topic's `publisherName`, and compares that publisher against `LIDO_ALLOWED_PUBLISHERS`. Only allowlisted topics are stored as governance proposals.

Stored proposals are deduplicated by:

```text
protocol + sourceType + sourceId
```

For Lido, that means:

```text
lido + forum + <discourse-topic-id>
```

If the same proposal appears again in a later fetch, the backend updates the existing record instead of creating a duplicate. It preserves when the proposal was first seen and updates when it was last seen.

## Current Capabilities

- Fetch Lido forum governance topics.
- Validate external Lido responses with Zod.
- Filter proposals by trusted publisher allowlist.
- Store normalized proposal records in Firestore or memory mode.
- Deduplicate proposals across repeated fetches.
- Track `firstSeenAt`, `lastSeenAt`, `createdAt`, and `updatedAt`.
- Track proposal notification state: `pending`, `sent`, `skipped`, or `failed`.
- Record fetch-run metadata with fetched, allowlisted, stored, updated, skipped, and notification counts.
- Optionally send Telegram notifications for new allowlisted proposals.
- Expose Express API endpoints for proposals, protocols, fetch runs, admin fetches, and debug/demo utilities.
- Run a credential-free fixture demo in memory mode.
- Run scheduled polling every 6 hours in normal mode.
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
  "lastSeenAt": "2026-06-05T10:00:00.000Z",
  "fetchedAt": "2026-06-05T10:00:00.000Z",
  "rawHash": "64-character-sha256-hash",
  "status": "new",
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
FETCH_INTERVAL_CRON=0 */6 * * *
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
```

Telegram is optional:

```bash
ENABLE_TELEGRAM_NOTIFICATIONS=false
TELEGRAM_BOT_TOKEN=replace-with-telegram-bot-token
TELEGRAM_CHAT_ID=replace-with-telegram-chat-id
NOTIFY_ON_NEW_PROPOSAL=true
```

## Development

Common commands:

```bash
npm install
npm run dev
npm run demo
npm test
npm run check
```

Use [PLATFORM_MANUAL.md](/Users/orzsikodon/Projects/governance-tracking/PLATFORM_MANUAL.md) for the full capability checklist, curl commands, Docker commands, and expected results.

## Adding Another Protocol Later

Add a new adapter under `src/protocols/<protocol>/` with a source client, Zod response schemas, normalizer, adapter, fixtures, and tests. Register it in `src/protocols/registry.ts`. The shared fetch job and repositories should remain protocol-agnostic.

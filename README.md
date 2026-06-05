# Governance Tracking

Backend MVP for tracking governance activity across protocols. The current implementation tracks Lido governance forum activity from `https://research.lido.fi`, filters items by trusted publishers, normalizes allowlisted topics into proposal records, and exposes the stored records through an Express API.

For step-by-step terminal usage, see [PLATFORM_MANUAL.md](./PLATFORM_MANUAL.md).

## Current MVP Scope

This step is intentionally focused on governance ingestion and storage. The backend can:

- Fetch recent Lido proposal topics from the public Discourse JSON API.
- Validate external Lido responses with Zod before using them.
- Extract a `publisherName` from each Lido forum topic.
- Filter fetched topics by `LIDO_ALLOWED_PUBLISHERS`.
- Normalize allowlisted topics into a protocol-agnostic proposal shape.
- Deduplicate proposals with deterministic IDs based on `protocol + sourceType + sourceId`.
- Persist structured proposal and fetch-run state in Firestore.
- Run without Firebase in memory mode for local demo and tests.
- Record fetch run metadata, including fetched, stored, skipped, success, and failure counts.
- Trigger fetches manually through the API.
- Run scheduled fetches with `node-cron`; the default schedule is once every 6 hours.
- Optionally protect every endpoint with a bearer token or `x-api-token` header.
- Run through Docker and docker-compose.
- Run a granular Jest/Supertest test suite.

Out of scope for this step:

- AI agents, summaries, classification, urgency scoring, recommended actions, or portfolio impact.
- Snapshot ingestion.
- On-chain governance ingestion.
- Aave, Pendle, Uniswap, or other protocol adapters.
- Angular dashboard implementation.
- Firebase Storage.

Angular with TypeScript and Angular Material are planned for the future dashboard, but there is no dashboard in this step.

## System Architecture

The backend is organized around protocol adapters, a generic fetch job, repositories, and API routes.

```text
Lido Discourse JSON
  -> LidoForumClient
  -> LidoAdapter
  -> publisher allowlist filter
  -> Lido normalizer
  -> ProposalRepository
  -> Firestore or memory storage
  -> Express API
```

Important source areas:

- `src/index.ts`: process entrypoint, server startup, scheduler startup, graceful shutdown.
- `src/server.ts`: Express app factory, middleware, routes, error handling.
- `src/config/env.ts`: environment parsing, defaults, and safe config output.
- `src/config/firebase.ts`: Firebase Admin and Firestore setup.
- `src/protocols/types.ts`: shared protocol adapter and proposal interfaces.
- `src/protocols/registry.ts`: protocol adapter registry.
- `src/protocols/allowlist.ts`: generic publisher allowlist matching.
- `src/protocols/lido/lidoForum.client.ts`: Lido Discourse JSON client.
- `src/protocols/lido/lido.adapter.ts`: Lido protocol adapter.
- `src/protocols/lido/lido.normalizer.ts`: Lido raw-item to normalized-proposal mapping.
- `src/jobs/fetchProtocolGovernance.job.ts`: fetch, filter, normalize, store, and fetch-run recording.
- `src/storage/*`: memory and Firestore repositories.
- `src/scheduler/scheduler.ts`: cron scheduling.
- `src/api/routes/*`: health, proposal, protocol, admin, and debug routes.
- `src/demo.ts`: fixture-backed demo run.
- `tests/*`: unit, fixture, and integration tests.

## Data Model

The MVP stores normalized proposals, not full raw Discourse responses.

Normalized proposal shape:

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
  "fetchedAt": "2026-06-05T10:00:00.000Z",
  "rawHash": "64-character-sha256-hash",
  "status": "new",
  "createdAt": "2026-06-05T10:00:00.000Z",
  "updatedAt": "2026-06-05T10:00:00.000Z"
}
```

Key fields:

- `id`: internal deterministic proposal id. Use this for `/api/proposals/:id`.
- `sourceId`: original upstream Lido/Discourse topic id. This is not the same as `id`.
- `publisherName`: field used for allowlist filtering.
- `rawHash`: deterministic hash of the source payload used by the normalizer.
- `status`: currently defaults to `new`; no workflow logic is implemented yet.

Fetch run shape:

```json
{
  "id": "fetchRun_lido_abc123def456",
  "protocol": "lido",
  "startedAt": "2026-06-05T10:00:00.000Z",
  "finishedAt": "2026-06-05T10:00:01.000Z",
  "status": "success",
  "fetchedCount": 30,
  "storedCount": 4,
  "skippedCount": 26
}
```

Firestore collections:

- `proposals/{proposalId}`
- `fetchRuns/{runId}`

## Publisher Allowlist

Only allowlisted publishers are persisted. The filter uses `publisherName`.

For Lido, `publisherName` is resolved from the Discourse topic in this order:

1. Find the topic poster whose `description` includes `Original Poster`.
2. Use that poster's `user_id` to find the matching user in the response `users` array.
3. Prefer `user.name`.
4. Fall back to `user.username`.
5. Fall back to `topic.last_poster_username`.
6. Fall back to `unknown`.

The allowlist comparison is:

- trimmed
- case-insensitive
- punctuation-normalized
- tolerant of small typos

Set the allowlist as a JSON array. Comma-separated values still work for backwards compatibility, but JSON is easier to read as the list grows.

```bash
LIDO_ALLOWED_PUBLISHERS='[
  "Publisher One",
  "Publisher Two"
]'
```

If no publisher matches, fetches can succeed while storing zero proposals. In that case, `storedCount` will be `0` and `skippedCount` will equal `fetchedCount`.

## Environment Configuration

Create or edit local config in `.env`.

```bash
nano .env
```

`.env` is ignored by git. Never commit Firebase credentials or API tokens.

Local demo/development defaults:

```bash
NODE_ENV=development
PORT=3000
STORAGE_MODE=memory
DEMO_MODE=true
ENABLE_SCHEDULER=false
ENABLE_DEBUG_ENDPOINTS=true
API_AUTH_ENABLED=false
```

Production-like values:

```bash
NODE_ENV=production
STORAGE_MODE=firestore
DEMO_MODE=false
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=0 */6 * * *
ENABLE_DEBUG_ENDPOINTS=false
API_AUTH_ENABLED=true
API_AUTH_TOKEN=replace-with-long-random-secret
LIDO_ALLOWED_PUBLISHERS='[
  "Publisher One",
  "Publisher Two"
]'
```

Firebase values required for Firestore mode:

```bash
FIREBASE_PROJECT_ID=replace-with-firebase-project-id
FIREBASE_CLIENT_EMAIL=replace-with-service-account-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace-with-service-account-private-key\n-----END PRIVATE KEY-----\n"
FIRESTORE_DATABASE_ID=
```

Notes:

- Leave `FIRESTORE_DATABASE_ID` blank for the default Firestore database.
- `FIREBASE_PRIVATE_KEY` may use escaped newlines as `\n`.
- Firebase Storage is not used.
- `CORS_ORIGIN` defaults to `http://localhost:4200` for the future Angular dashboard.

## Running The Backend

Install dependencies:

```bash
npm install
```

Start development server:

```bash
npm run dev
```

Build TypeScript:

```bash
npm run build
```

Run compiled output:

```bash
npm run start
```

Run the fixture demo:

```bash
npm run demo
```

For interactive usage and expected endpoint responses, see [PLATFORM_MANUAL.md](./PLATFORM_MANUAL.md).

## API Overview

Read/config endpoints do not call Lido or Discourse. `/health`, `/api/protocols`, `/api/proposals`, and `/api/proposals/:id` read app state from config, memory storage, or Firestore.

The endpoints that call Lido/Discourse are `/api/debug/lido/recent`, `/api/debug/lido/fetch-once`, and `/api/admin/fetch/lido`.

Live-fetch endpoint behavior:

- `GET /api/debug/lido/recent`: fetches live Lido forum items and returns them without filtering, normalizing, or storing. Use this to inspect current `publisherName` values.
- `POST /api/debug/lido/fetch-once`: fetches live Lido items, filters by `LIDO_ALLOWED_PUBLISHERS`, normalizes matches, stores them, and returns a fetch-run summary. Debug endpoint only.
- `POST /api/admin/fetch/lido`: same fetch/filter/normalize/store behavior as debug fetch-once, but intended as the production-style manual admin trigger.

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/` | Service name and core route list. |
| `GET` | `/health` | `{ ok, storageMode, schedulerEnabled }`. |
| `GET` | `/api/protocols` | Registered protocol adapters and source metadata. |
| `GET` | `/api/proposals` | Stored proposal list. Supports `protocol` and `limit`. |
| `GET` | `/api/proposals/:id` | One stored proposal by internal proposal id. |
| `POST` | `/api/admin/fetch/lido` | Fetch-run summary after fetching and storing Lido proposals. |
| `GET` | `/api/debug/config-safe` | Non-secret runtime config. Debug only. |
| `GET` | `/api/debug/lido/recent` | Live Lido items before allowlist filtering. Debug only. |
| `POST` | `/api/debug/lido/fetch-once` | Fetch-run summary for a one-off debug fetch. Debug only. |

Debug endpoints require:

```bash
ENABLE_DEBUG_ENDPOINTS=true
```

If auth is enabled, every endpoint requires either:

```bash
Authorization: Bearer <API_AUTH_TOKEN>
```

or:

```bash
x-api-token: <API_AUTH_TOKEN>
```

## Scheduler

Scheduled fetches are controlled by:

```bash
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=0 */6 * * *
```

Every scheduled run performs the same flow as a manual fetch:

1. Fetch recent Lido forum topics.
2. Filter by `LIDO_ALLOWED_PUBLISHERS`.
3. Normalize allowlisted items.
4. Upsert proposals.
5. Record fetch-run metadata.

The fetch job prevents overlapping runs for the same protocol.

## Testing

Run all tests:

```bash
npm test
```

Run build plus all tests:

```bash
npm run check
```

Run tests in watch mode:

```bash
npm run test:watch
```

The suite covers:

- env parsing and safe config
- Firebase config validation
- allowlist matching
- deterministic IDs and hashes
- Lido response validation and mapping
- Lido adapter behavior
- normalization
- memory repositories
- mocked Firestore repositories
- fetch run repository behavior
- fetch job success, skip, failure, overlap, and retry behavior
- scheduler behavior
- API route behavior and auth enforcement

The tests use representative fixture data and mocked external dependencies where needed. They do not rely on live network calls, which keeps the suite deterministic.

## Docker

Run local development with docker-compose:

```bash
docker compose up --build
```

Run fixture demo with docker-compose:

```bash
docker compose -f docker-compose.demo.yml up --build
```

Build and run the production image:

```bash
docker build -t governance-tracking-backend .
docker run --env-file .env -p 3000:3000 governance-tracking-backend
```

Secrets are injected at runtime through environment variables. They are not baked into the image.

## Adding Another Protocol Later

The current Lido adapter is the reference implementation. A new protocol should add:

1. A protocol folder under `src/protocols/<protocol>/`.
2. A source client that fetches external governance data.
3. Zod schemas for external response validation.
4. A normalizer that returns `NormalizedGovernanceItem`.
5. A `ProtocolAdapter` implementation.
6. Registration in the protocol registry.
7. Protocol-specific environment values and publisher allowlist support.
8. Fixtures and unit/integration tests before scheduled fetches are enabled.

The shared fetch job and repositories should not need protocol-specific branching for normal forum-like sources.

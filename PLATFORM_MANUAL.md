# Platform Manual

Quick terminal reference for running the governance tracking MVP.

Assumes the API is available at `http://localhost:3000`.

## Start

```bash
npm install
nano .env
npm run dev
```

Local development settings:

```bash
STORAGE_MODE=memory
DEMO_MODE=true
ENABLE_SCHEDULER=false
ENABLE_DEBUG_ENDPOINTS=true
API_AUTH_ENABLED=false
```

## Endpoint Sources

These read app state from config, memory, or Firestore. They do not call Lido:

- `GET /health`
- `GET /api/protocols`
- `GET /api/proposals`
- `GET /api/proposals/:id`

These call Lido/Discourse:

- `GET /api/debug/lido/recent`: preview live Lido items only; does not store.
- `POST /api/debug/lido/fetch-once`: fetch, filter, normalize, store, and return counts; debug only.
- `POST /api/admin/fetch/lido`: production-style manual fetch with the same store behavior.

## Core Flow

Check the service:

```bash
curl -s http://localhost:3000/
curl -s http://localhost:3000/health
curl -s http://localhost:3000/api/protocols
```

Expected return: service metadata, health, and registered protocols.

Preview live Lido data:

```bash
curl -s http://localhost:3000/api/debug/lido/recent
```

Expected return: live items with `sourceId`, `publisherName`, `sourceUrl`, and raw source data. Nothing is stored.

Update `.env` with trusted publishers:

```bash
LIDO_ALLOWED_PUBLISHERS='[
  "Publisher One",
  "Publisher Two"
]'
```

Restart `npm run dev`, then fetch and store allowlisted proposals:

```bash
curl -s -X POST http://localhost:3000/api/debug/lido/fetch-once
```

Expected return: fetch-run counts, especially `fetchedCount`, `storedCount`, and `skippedCount`.

List stored proposals:

```bash
curl -s "http://localhost:3000/api/proposals?protocol=lido&limit=5"
```

Expected return: stored normalized proposals. Use the returned `id`, not `sourceId`.

Read one stored proposal:

```bash
curl -s http://localhost:3000/api/proposals/<proposal-id>
```

Expected return: one proposal, or `Proposal not found`.

## Useful Commands

Run fixture demo:

```bash
npm run demo
```

Expected return: formatted JSON showing fixture fetch, filtering, storage, and skipped count.

Run tests:

```bash
npm test
```

Expected return: all Jest tests pass.

Run build plus tests:

```bash
npm run check
```

Expected return: TypeScript build passes, then all tests pass.

## Auth Check

Enable auth:

```bash
API_AUTH_ENABLED=true
API_AUTH_TOKEN=dev-secret-change-me
```

Without a token:

```bash
curl -i http://localhost:3000/health
```

Expected return: `401`.

With a token:

```bash
curl -s http://localhost:3000/health \
  -H "Authorization: Bearer dev-secret-change-me"
```

Expected return: normal health response.

## Scheduler Check

Normal schedule:

```bash
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=0 */6 * * *
```

Quick local test schedule:

```bash
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=* * * * *
```

Expected behavior: scheduled runs do the same fetch/filter/normalize/store flow as debug fetch-once.

## Firestore Mode

Set:

```bash
STORAGE_MODE=firestore
DEMO_MODE=false
FIREBASE_PROJECT_ID=replace-with-firebase-project-id
FIREBASE_CLIENT_EMAIL=replace-with-service-account-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace-with-service-account-private-key\n-----END PRIVATE KEY-----\n"
```

Run:

```bash
npm run build
npm run start
```

Trigger admin fetch:

```bash
curl -s -X POST http://localhost:3000/api/admin/fetch/lido \
  -H "Authorization: Bearer $API_AUTH_TOKEN"
```

Expected return: fetch-run counts; stored proposals and fetch runs go to Firestore.

## Docker

```bash
docker compose up --build
docker compose -f docker-compose.demo.yml up --build
docker build -t governance-tracking-backend .
docker run --env-file .env -p 3000:3000 governance-tracking-backend
```

For deeper explanations and troubleshooting, see [README.md](./README.md).

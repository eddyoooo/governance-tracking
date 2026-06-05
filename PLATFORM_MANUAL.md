# Platform Manual

Terminal manual for running and exercising the governance tracking MVP.

The examples assume the API is running on `http://localhost:3000`.

## 1. Start The App

Install dependencies:

```bash
npm install
```

For local development, keep these values in `.env`:

```bash
STORAGE_MODE=memory
DEMO_MODE=true
ENABLE_SCHEDULER=false
ENABLE_DEBUG_ENDPOINTS=true
API_AUTH_ENABLED=false
```

Start the backend:

```bash
npm run dev
```

Expected result: the Express API starts on port `3000`.

Use a second terminal for the commands below.

## Endpoint Data Sources

These endpoints do not call Lido/Discourse. They read app state from config, memory storage, or Firestore:

- `GET /health`
- `GET /api/protocols`
- `GET /api/proposals`
- `GET /api/proposals/:id`

These endpoints do call Lido/Discourse:

- `GET /api/debug/lido/recent`
- `POST /api/debug/lido/fetch-once`
- `POST /api/admin/fetch/lido`

Live-fetch endpoint behavior:

- `GET /api/debug/lido/recent`: previews live Lido forum items. It does not filter, normalize, or store records.
- `POST /api/debug/lido/fetch-once`: debug-only one-off fetch that filters by allowlist, normalizes matches, stores proposals, and returns counts.
- `POST /api/admin/fetch/lido`: production-style manual fetch trigger with the same fetch/filter/normalize/store behavior as debug fetch-once.

## 2. Check Service Health

```bash
curl -s http://localhost:3000/
```

Expected return: service name and core route list.

```json
{
  "name": "governance-tracking",
  "routes": [
    "GET /health",
    "GET /api/proposals",
    "GET /api/proposals/:id",
    "GET /api/protocols",
    "POST /api/admin/fetch/lido"
  ]
}
```

```bash
curl -s http://localhost:3000/health
```

Expected return: health state, storage mode, and scheduler state.

```json
{
  "ok": true,
  "storageMode": "memory",
  "schedulerEnabled": false
}
```

## 3. Inspect Protocols And Stored Proposals

```bash
curl -s http://localhost:3000/api/protocols
```

Expected return: registered protocol adapters. Today this should include `lido`.

```json
{
  "protocols": [
    {
      "protocol": "lido",
      "enabled": true,
      "source": {
        "protocol": "lido",
        "type": "forum",
        "name": "Lido Research Forum",
        "baseUrl": "https://research.lido.fi"
      },
      "allowedPublisherCount": 0
    }
  ]
}
```

```bash
curl -s http://localhost:3000/api/proposals
```

Expected return: stored proposals.

In fresh memory mode this is usually empty:

```json
{
  "proposals": []
}
```

## 4. Inspect Live Lido Data Without Storing

```bash
curl -s http://localhost:3000/api/debug/config-safe
```

Expected return: non-secret runtime config. It never returns Firebase private keys, API tokens, or service account values.

```json
{
  "nodeEnv": "development",
  "storageMode": "memory",
  "demoMode": true,
  "enableScheduler": false,
  "fetchIntervalCron": "0 */6 * * *",
  "enableDebugEndpoints": true,
  "lido": {
    "enabled": true,
    "allowedPublisherCount": 0
  },
  "apiAuth": {
    "enabled": false,
    "hasToken": true
  }
}
```

```bash
curl -s http://localhost:3000/api/debug/lido/recent
```

Expected return: live Lido forum items before allowlist filtering or storage.

Useful fields in the response:

- `count`: number of fetched live items.
- `items[].sourceId`: original Discourse topic id.
- `items[].publisherName`: the field used for allowlist matching.
- `items[].sourceUrl`: link back to Lido Research.

Important: this endpoint does not store proposals.

## 5. Allow Publishers And Store Proposals

Choose publisher names from `/api/debug/lido/recent`, then edit `.env`:

```bash
nano .env
```

Set:

```bash
LIDO_ALLOWED_PUBLISHERS='[
  "Exact Publisher Name",
  "Another Publisher"
]'
```

Restart `npm run dev`, then run:

```bash
curl -s -X POST http://localhost:3000/api/debug/lido/fetch-once
```

Expected return: fetch-run summary.

```json
{
  "run": {
    "id": "fetchRun_lido_abc123def456",
    "protocol": "lido",
    "status": "success",
    "fetchedCount": 30,
    "storedCount": 4,
    "skippedCount": 26
  },
  "fetchedCount": 30,
  "storedCount": 4,
  "skippedCount": 26
}
```

Interpretation:

- `fetchedCount`: live Lido items fetched from Discourse.
- `storedCount`: allowlisted items normalized and upserted.
- `skippedCount`: items skipped because `publisherName` did not match the allowlist.

If `storedCount` is `0` and `skippedCount` equals `fetchedCount`, your allowlist did not match current publishers.

## 6. List And Read Stored Proposals

```bash
curl -s "http://localhost:3000/api/proposals?protocol=lido&limit=5"
```

Expected return: normalized stored proposal records.

```json
{
  "proposals": [
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
  ]
}
```

Read one proposal:

```bash
curl -s http://localhost:3000/api/proposals/<proposal-id>
```

Expected return: one stored proposal.

Use the internal `id` returned from `/api/proposals`, not the raw Lido `sourceId`. For example, use `lido_forum_11415_abc123def0`, not `11415`.

If the id is missing or was never stored, expected return:

```json
{
  "error": "Proposal not found."
}
```

## 7. Run The Fixture Demo

```bash
npm run demo
```

Expected return: formatted JSON showing the fetch/filter/store flow using local fixture data.

```json
{
  "demoMode": true,
  "fetchedFixtureItems": 2,
  "allowedPublishers": ["Allowed Publisher"],
  "storedNormalizedProposals": 1,
  "skippedNonAllowlistedPublishers": 1,
  "proposals": []
}
```

The real demo output includes the stored proposal record.

## 8. Run Tests

```bash
npm test
```

Expected return: all Jest unit and integration tests pass.

```bash
npm run check
```

Expected return: TypeScript build passes, then all tests pass.

## 9. Test API Auth

Edit `.env`:

```bash
API_AUTH_ENABLED=true
API_AUTH_TOKEN=dev-secret-change-me
```

Restart `npm run dev`.

Without a token:

```bash
curl -i http://localhost:3000/health
```

Expected return: `401 Missing API auth token`.

With a bearer token:

```bash
curl -s http://localhost:3000/health \
  -H "Authorization: Bearer dev-secret-change-me"
```

Expected return: normal health response.

With `x-api-token`:

```bash
curl -s http://localhost:3000/api/proposals \
  -H "x-api-token: dev-secret-change-me"
```

Expected return: normal proposals response.

When auth is enabled, every endpoint requires the token. Use HTTPS in real deployments.

## 10. Test The Scheduler

Normal schedule:

```bash
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=0 */6 * * *
```

Quick local schedule:

```bash
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=* * * * *
```

Restart `npm run dev`.

Expected behavior: the scheduled job runs the same fetch/filter/normalize/store flow as `/api/debug/lido/fetch-once`.

If no publishers match the allowlist, the scheduler will still run successfully, but it will store `0` proposals.

## 11. Run Firestore Mode

Set real Firebase credentials in `.env`:

```bash
STORAGE_MODE=firestore
DEMO_MODE=false
FIREBASE_PROJECT_ID=replace-with-firebase-project-id
FIREBASE_CLIENT_EMAIL=replace-with-service-account-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace-with-service-account-private-key\n-----END PRIVATE KEY-----\n"
FIRESTORE_DATABASE_ID=
```

Recommended production-like values:

```bash
ENABLE_SCHEDULER=true
ENABLE_DEBUG_ENDPOINTS=false
API_AUTH_ENABLED=true
API_AUTH_TOKEN=replace-with-long-random-secret
LIDO_ALLOWED_PUBLISHERS='[
  "Publisher One",
  "Publisher Two"
]'
```

Build and start:

```bash
npm run build
npm run start
```

Trigger a protected fetch:

```bash
curl -s -X POST http://localhost:3000/api/admin/fetch/lido \
  -H "Authorization: Bearer $API_AUTH_TOKEN"
```

Expected return: fetch-run summary. Stored proposals and fetch runs are written to Firestore.

## 12. Docker

Local development:

```bash
docker compose up --build
```

Expected behavior: starts the backend in dev mode.

Fixture demo:

```bash
docker compose -f docker-compose.demo.yml up --build
```

Expected behavior: runs the fixture demo and exits.

Production image:

```bash
docker build -t governance-tracking-backend .
docker run --env-file .env -p 3000:3000 governance-tracking-backend
```

Expected behavior: runs compiled TypeScript output using env values injected at runtime.

## Troubleshooting

`storedCount` is `0`:

Your allowlist did not match any fetched `publisherName`. Inspect live publishers with `/api/debug/lido/recent`, update `LIDO_ALLOWED_PUBLISHERS`, restart the server, and fetch again.

`/api/proposals/11415` returns `Proposal not found`:

`11415` is a Lido `sourceId`, not the internal stored proposal `id`. List proposals first and use the returned `id`.

Debug endpoint returns `404`:

Set `ENABLE_DEBUG_ENDPOINTS=true` and restart the server.

Every endpoint returns `401`:

`API_AUTH_ENABLED=true`. Send `Authorization: Bearer <API_AUTH_TOKEN>` or `x-api-token: <API_AUTH_TOKEN>`.

Firestore mode fails on startup:

Check `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. Firebase Storage is not required.

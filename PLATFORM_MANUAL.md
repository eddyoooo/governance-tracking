# Platform Manual

Quick terminal guide for the current governance tracking MVP.

Assume the API is at `http://localhost:3000`.

## Start In Development

Use credential-free demo/memory mode:

```bash
npm install
npm run dev
```

Recommended local `.env` values:

```bash
NODE_ENV=development
PORT=3000
STORAGE_MODE=memory
DEMO_MODE=true
ENABLE_SCHEDULER=false
ENABLE_DEBUG_ENDPOINTS=true
API_AUTH_ENABLED=false
LIDO_ALLOWED_PUBLISHERS='["Allowed Publisher"]'
```

In memory/demo mode, data lives only inside the running Node process. Restarting the app clears it.

## One-Shot Demo

```bash
npm run demo
```

Expected return: formatted JSON showing a fixture-backed first fetch that inserts one allowlisted proposal, a second fetch that updates the same proposal, skipped non-allowlisted items, and final stored proposals.

## API Demo Flow

Check service state:

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/api/protocols
```

Expected return: health info and registered protocol metadata.

Preview Lido adapter items:

```bash
curl -s http://localhost:3000/api/debug/lido/recent
```

Expected return: recent Lido items. In demo/memory mode this is fixture data; in normal Firestore mode it calls Lido.

Fetch, filter, store, and record a run:

```bash
curl -s -X POST http://localhost:3000/api/admin/fetch/lido
```

Expected return: counts such as `fetchedCount`, `allowlistedCount`, `storedNewCount`, `updatedExistingCount`, `skippedCount`, and notification counts.

List stored proposals:

```bash
curl -s "http://localhost:3000/api/proposals?protocol=lido&limit=5"
```

Expected return: stored proposals from memory or Firestore. This endpoint does not call Lido.

Read one proposal:

```bash
curl -s http://localhost:3000/api/proposals/<internal-proposal-id>
curl -s http://localhost:3000/api/proposals/source/lido/forum/<lido-topic-id>
```

Expected return: one stored proposal, or `Proposal not found`.

List fetch runs:

```bash
curl -s http://localhost:3000/api/admin/fetch-runs
```

Expected return: stored fetch-run records from memory or Firestore.

Notify pending proposals:

```bash
curl -s -X POST http://localhost:3000/api/admin/notify-pending
```

Expected return: `pendingCount`, `sentCount`, `failedCount`, `skippedCount`, and `errors`.

Reset demo state:

```bash
curl -s -X POST http://localhost:3000/api/debug/reset-demo-state
```

Expected return: `{ "reset": true }`. Only works when debug endpoints are enabled and storage is memory/demo.

## Query Examples

```bash
curl -s "http://localhost:3000/api/proposals?notificationStatus=sent"
curl -s "http://localhost:3000/api/proposals?publisherName=Allowed%20Publisher"
curl -s "http://localhost:3000/api/proposals?sort=lastSeenAt_desc&limit=10&offset=0"
```

Expected return: filtered stored proposal lists. These queries read storage only.

## Production-Like Run

Set Firestore and auth values:

```bash
NODE_ENV=production
STORAGE_MODE=firestore
DEMO_MODE=false
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=0 */6 * * *
ENABLE_DEBUG_ENDPOINTS=false
API_AUTH_ENABLED=true
API_AUTH_TOKEN=replace-with-long-random-secret
FIREBASE_PROJECT_ID=replace-with-project-id
FIREBASE_CLIENT_EMAIL=replace-with-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace\n-----END PRIVATE KEY-----\n"
```

Run:

```bash
npm run build
npm run start
```

Authenticated request:

```bash
curl -s http://localhost:3000/health \
  -H "Authorization: Bearer $API_AUTH_TOKEN"
```

## Telegram

```bash
ENABLE_TELEGRAM_NOTIFICATIONS=true
TELEGRAM_BOT_TOKEN=replace-with-token
TELEGRAM_CHAT_ID=replace-with-chat-id
NOTIFY_ON_NEW_PROPOSAL=true
```

Expected behavior: newly discovered allowlisted proposals are notified once. Existing proposals are updated but not notified again.

## Tests

```bash
npm test
npm run check
npm run test:watch
```

`npm test` runs all Jest tests. `npm run check` runs TypeScript build plus all tests.

## Docker

```bash
docker compose up --build
docker compose -f docker-compose.demo.yml up --build
docker build -t governance-tracking-backend .
docker run --env-file .env -p 3000:3000 governance-tracking-backend
```

The demo compose file runs memory/demo mode and does not need Firebase or Telegram credentials.

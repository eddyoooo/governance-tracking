# Platform Manual

Terminal playbook for the current governance tracking MVP.

Base URL:

```bash
API=http://localhost:3000
```

## 1. Start The App

Development/demo mode:

```bash
npm install
npm run dev
```

Use these local `.env` values for a credential-free run:

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

Expected result: API starts on port `3000`, uses in-memory storage, uses fixture-backed Lido data, and does not require Firebase or Telegram.

## 2. Run The One-Shot Demo

```bash
npm run demo
```

Expected result: JSON showing two fetches. The first fetch stores one allowlisted proposal. The second fetch sees the same proposal again and updates it instead of creating a duplicate. `storedProposalCount` should remain `1`.

## 3. Check Service Health

```bash
curl -s "$API/health"
```

Expected result:

```json
{
  "ok": true,
  "storageMode": "memory",
  "schedulerEnabled": false
}
```

## 4. See Registered Protocols

```bash
curl -s "$API/api/protocols"
```

Expected result: registered protocols, currently Lido, including source metadata and allowlist count.

## 5. Preview Lido Items Before Storage

```bash
curl -s "$API/api/debug/lido/recent"
```

Expected result: recent Lido adapter items with `sourceId`, `title`, `publisherName`, `sourceUrl`, and raw payload data.

Important: this does not store proposals. It is for inspecting what the adapter sees before allowlist filtering.

## 6. Fetch, Filter, Store

```bash
curl -s -X POST "$API/api/admin/fetch/lido"
```

Expected result:

```json
{
  "protocol": "lido",
  "fetchedCount": 2,
  "allowlistedCount": 1,
  "storedNewCount": 1,
  "updatedExistingCount": 0,
  "skippedCount": 1,
  "notificationPendingCount": 0,
  "notificationSentCount": 0,
  "notificationFailedCount": 0,
  "errors": []
}
```

Run it again:

```bash
curl -s -X POST "$API/api/admin/fetch/lido"
```

Expected result: `storedNewCount` becomes `0`, `updatedExistingCount` becomes `1`, and no duplicate proposal is created.

## 7. List Stored Proposals

```bash
curl -s "$API/api/proposals?protocol=lido&limit=5"
```

Expected result: stored proposals after allowlist filtering. This endpoint reads memory or Firestore only; it does not call Lido.

Useful filters:

```bash
curl -s "$API/api/proposals?publisherName=Allowed%20Publisher"
curl -s "$API/api/proposals?notificationStatus=skipped"
curl -s "$API/api/proposals?sort=lastSeenAt_desc&limit=10&offset=0"
```

Expected result: filtered proposal lists.

## 8. Read One Proposal

By internal proposal id:

```bash
curl -s "$API/api/proposals/<internal-proposal-id>"
```

By source identity:

```bash
curl -s "$API/api/proposals/source/lido/forum/<lido-topic-id>"
```

Expected result: one stored proposal, or:

```json
{
  "error": "Proposal not found."
}
```

Use source identity when you only know the Lido/Discourse topic id.

## 9. List Fetch Runs

```bash
curl -s "$API/api/admin/fetch-runs"
```

Expected result: stored fetch-run records showing what each run fetched, stored, updated, skipped, and notified.

Useful options:

```bash
curl -s "$API/api/admin/fetch-runs?limit=5&offset=0&sort=startedAt_desc"
```

## 10. Notify Pending Proposals

```bash
curl -s -X POST "$API/api/admin/notify-pending"
```

Expected result:

```json
{
  "pendingCount": 0,
  "sentCount": 0,
  "failedCount": 0,
  "skippedCount": 0,
  "errors": []
}
```

If Telegram is disabled, pending proposals are marked `skipped`. If Telegram is enabled, pending proposals are sent and marked `sent` or `failed`.

## 11. Inspect Safe Config

```bash
curl -s "$API/api/debug/config-safe"
```

Expected result: non-secret runtime config. It shows booleans such as whether Firebase keys or API tokens are present, but never returns raw secrets.

## 12. Reset Demo State

```bash
curl -s -X POST "$API/api/debug/reset-demo-state"
```

Expected result:

```json
{
  "reset": true,
  "storageMode": "memory"
}
```

Only works when `ENABLE_DEBUG_ENDPOINTS=true` and storage is memory/demo.

## 13. Test Auth Protection

Set:

```bash
API_AUTH_ENABLED=true
API_AUTH_TOKEN=replace-with-long-random-secret
```

Without token:

```bash
curl -i "$API/health"
```

Expected result: `401`.

With token:

```bash
curl -s "$API/health" \
  -H "Authorization: Bearer $API_AUTH_TOKEN"
```

Expected result: normal health response.

Alternative header:

```bash
curl -s "$API/health" \
  -H "x-api-token: $API_AUTH_TOKEN"
```

## 14. Test Telegram Setup

Set:

```bash
ENABLE_TELEGRAM_NOTIFICATIONS=true
TELEGRAM_BOT_TOKEN=replace-with-token
TELEGRAM_CHAT_ID=replace-with-chat-id
NOTIFY_ON_NEW_PROPOSAL=true
```

Then run:

```bash
curl -s -X POST "$API/api/admin/fetch/lido"
```

Expected result: new allowlisted proposals are notified once. Existing proposals are updated but not notified again.

## 15. Run Tests

```bash
npm test
```

Expected result: all Jest/Supertest tests pass.

```bash
npm run check
```

Expected result: TypeScript build passes, then all tests pass.

```bash
npm run test:watch
```

Expected result: Jest watch mode starts for active development.

## 16. Run With Firestore

Set:

```bash
NODE_ENV=production
STORAGE_MODE=firestore
DEMO_MODE=false
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=0 */6 * * *
ENABLE_DEBUG_ENDPOINTS=false
API_AUTH_ENABLED=true
FIREBASE_PROJECT_ID=replace-with-project-id
FIREBASE_CLIENT_EMAIL=replace-with-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace\n-----END PRIVATE KEY-----\n"
```

Run:

```bash
npm run build
npm run start
```

Expected result: proposals and fetch runs are stored in Firestore.

## 17. Run With Docker

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

Expected result: backend listens on local port `3000`. Demo compose uses memory mode and does not require Firebase or Telegram.

## Endpoint Source Map

These read stored app state only:

```text
GET /health
GET /api/protocols
GET /api/proposals
GET /api/proposals/:id
GET /api/proposals/source/:protocol/:sourceType/:sourceId
GET /api/admin/fetch-runs
```

These fetch through the Lido adapter:

```text
GET /api/debug/lido/recent
POST /api/debug/lido/fetch-once
POST /api/admin/fetch/lido
```

In demo/memory mode, the Lido adapter uses fixtures. In normal Firestore mode, it calls Lido/Discourse.

## Common Results

`fetchedCount > 0` and `allowlistedCount = 0`: fetch worked, but allowlist matched nothing.

`storedNewCount = 1`: a new allowlisted proposal was discovered.

`updatedExistingCount = 1`: an already-known proposal appeared again and was updated.

`skippedCount > 0`: fetched items were ignored because their publisher was not allowlisted.

`notificationFailedCount > 0`: proposal storage worked, but Telegram failed.

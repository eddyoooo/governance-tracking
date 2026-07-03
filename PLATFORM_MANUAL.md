# Platform Manual

Compact operator playbook for the current monitor-only governance tracking service.

```bash
API=http://localhost:3000
```

## Go-Live Checklist

Run before deploying or restarting production:

```bash
npm run check
DEMO_STEP_DELAY_MS=0 npm run demo
docker build -t governance-tracker-bot .
```

Expected result: build/typecheck/tests pass, the demo completes without Firebase, and the production Docker image builds.

After the production service starts:

```bash
curl -s "$API/health" -H "Authorization: Bearer $API_AUTH_TOKEN"
curl -s -X POST "$API/api/admin/fetch/lido" -H "Authorization: Bearer $API_AUTH_TOKEN"
curl -s -X POST "$API/api/admin/fetch/aave" -H "Authorization: Bearer $API_AUTH_TOKEN"
curl -s -X POST "$API/api/admin/fetch/uniswap" -H "Authorization: Bearer $API_AUTH_TOKEN"
curl -s "$API/api/admin/fetch-runs" -H "Authorization: Bearer $API_AUTH_TOKEN"
curl -s "$API/api/admin/source-activity" -H "Authorization: Bearer $API_AUTH_TOKEN"
```

Expected result: the health endpoint returns `ok: true`, each manual fetch returns a successful run, fetch-run records exist, and source-activity records exist for all enabled protocols.

Production note: if more than one backend replica is running, keep `ENABLE_SCHEDULER=true` on only one worker when possible. Firestore proposal upserts are transaction-backed, but multiple schedulers still create duplicate polling work and extra fetch-run audit records.

## Fast Colleague Demo

Run the full terminal walkthrough:

```bash
DEMO_STEP_DELAY_MS=750 npm run demo
```

What to point out:

- Lido, Aave, and Uniswap are fetched through the same monitor pipeline.
- Only allowlisted publishers are stored.
- Non-allowlisted items are counted as skipped.
- New allowlisted proposals trigger notification handling.
- Duplicate fetches do not create duplicate proposals or rewrite unchanged documents.
- Fetch-run audit records show exactly what happened.
- Source-activity records show whether each raw forum source is still active.

API version of the same story:

```bash
npm run dev
```

Then in another terminal:

```bash
curl -s "$API/health"
curl -s -X POST "$API/api/admin/fetch/lido"
curl -s -X POST "$API/api/admin/fetch/aave"
curl -s -X POST "$API/api/admin/fetch/uniswap"
curl -s "$API/api/admin/fetch-runs"
curl -s "$API/api/admin/source-activity"
curl -s -X POST "$API/api/admin/notify-pending"
```

## 1. Start Locally

Use memory mode when you want to run without Firebase:

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
ENABLE_SOURCE_ACTIVITY_ALERTS=true
API_AUTH_ENABLED=false
ENABLE_TELEGRAM_NOTIFICATIONS=false
ENABLE_ADMIN_STATUS_REPORTS=false
```

Expected result: the API starts on port `3000`, stores data in memory, does not require Firebase, and does not run the scheduler.

`PORT` must be between `1` and `65535`. `LOG_LEVEL` can be `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`.

## 2. Run The Terminal Demo

```bash
npm run demo
```

Expected result: a step-by-step terminal walkthrough of the real monitor flow.

What it demonstrates:

- Lido fetches from locally saved proposal-category payload samples.
- Aave fetches from locally saved global latest and category/subcategory payload samples.
- Aave allowlist matching uses real Discourse usernames: `LlamaRisk`, `TokenLogic`, `Certora`, `kpk`, `karpatkey_TokenLogic`, `AaveLabs`, and `stani`.
- Uniswap fetches from locally saved global latest and public category/subcategory payload samples.
- Uniswap allowlist matching uses stable profile usernames such as `haydenadams`, `devinwalsh`, `kenneth`, `nataliara`, `GFXlabs`, and `UniswapFoundation`, while stored proposal output may show display names such as `Hayden Adams`, `Devin`, `Ken Ng`, or `GFX Labs`.
- Allowlisted publishers are stored.
- Non-allowlisted publishers are skipped.
- New proposals trigger notification handling.
- Duplicate fetches do not create duplicate proposals.
- Unchanged repeat sightings are counted without rewriting proposal documents.
- Stored proposal snapshots are printed directly from the repository.
- Fetch-run audit records are printed directly from the repository.
- Source-activity watchdog records are printed directly from the repository.

Fast mode:

```bash
DEMO_STEP_DELAY_MS=0 npm run demo
```

Telegram demo mode: set `ENABLE_TELEGRAM_NOTIFICATIONS=true`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_ALLOWED_USER_IDS`, then run `npm run demo`. Each newly discovered allowlisted proposal can send a direct Telegram notification.

Admin status demo mode: set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_USER_ID`, then run:

```bash
npm run demo:admin
```

Expected result: the normal terminal demo runs, then the final operator status report is sent to the configured Telegram admin.

Plain `npm run demo` keeps the admin status demo off even if production admin reports are enabled in `.env`.

## 3. Health Check

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

This endpoint does not call Lido, Aave, or Uniswap.

## 4. Manual Fetch

```bash
curl -s -X POST "$API/api/admin/fetch/lido"
curl -s -X POST "$API/api/admin/fetch/aave"
curl -s -X POST "$API/api/admin/fetch/uniswap"
```

Expected result:

```json
{
  "protocol": "lido",
  "fetchedCount": 30,
  "allowlistedCount": 3,
  "storedNewCount": 1,
  "updatedExistingCount": 0,
  "unchangedExistingCount": 2,
  "skippedCount": 27,
  "notificationSentCount": 1,
  "notificationFailedCount": 0,
  "errors": []
}
```

These endpoints call the protocol adapters. In memory/demo mode, adapters use local payload samples. In Firestore production mode, adapters call the live forums. Lido uses the proposal category feed, while Aave and Uniswap scan global latest plus discovered public category/subcategory feeds.

Count meanings:

- `fetchedCount`: all source items inspected.
- `allowlistedCount`: fetched items whose publisher matched the allowlist.
- `storedNewCount`: allowlisted items stored for the first time.
- `updatedExistingCount`: existing items changed in meaningful source fields.
- `unchangedExistingCount`: existing items were seen again but not rewritten.
- `skippedCount`: fetched items ignored because the publisher was not allowlisted.
- `notificationSentCount`: new proposal notifications sent during the run.
- `notificationFailedCount`: notification attempts that failed.

For unchanged repeat sightings, the stored proposal is not rewritten, so `lastSeenAt`, `fetchedAt`, and `updatedAt` stay at the last meaningful insert/update time.

## 5. Source Activity

```bash
curl -s "$API/api/admin/source-activity"
```

Expected result: latest source freshness records for each protocol.

```json
{
  "sourceActivity": [
    {
      "protocol": "aave",
      "sourceType": "forum",
      "latestRawSourceId": "25170",
      "latestRawPublishedAt": "2026-07-01T00:00:00.000Z",
      "lastFetchedCount": 120,
      "consecutiveStaleRuns": 0,
      "status": "healthy"
    }
  ]
}
```

This endpoint reads stored watchdog records only. It does not call protocol forums. The watchdog uses all raw fetched forum items, before allowlist filtering, so it can flag silent forum migrations or stale category feeds even when no allowlisted publisher has posted.

## 6. Fetch-Run Audit

```bash
curl -s "$API/api/admin/fetch-runs"
```

Expected result: latest stored fetch-run audit records, newest first.

```json
{
  "fetchRuns": [
    {
      "id": "fetchRun_lido_abc123",
      "protocol": "lido",
      "status": "success",
      "fetchedCount": 30,
      "storedNewCount": 1,
      "skippedCount": 27,
      "errors": []
    }
  ]
}
```

This endpoint reads stored fetch-run records only. It does not call protocol forums.

## 7. Retry Pending Notifications

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

If Telegram is disabled, pending proposals are marked `skipped`. If Telegram is enabled, the service attempts to send each pending proposal to every allowed Telegram user and marks proposals `sent` or `failed`.

## 8. Auth Check

Set:

```bash
API_AUTH_ENABLED=true
API_AUTH_TOKEN=replace-with-long-random-secret
```

Use HTTPS in production. Request logs redact auth headers and known secret fields, but the token should still be treated like a password.

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

## 9. Telegram Test

Telegram notifications are direct user messages, not group/channel messages. Each recipient must open the bot and send `/start` once. The backend sends only to numeric IDs listed in `TELEGRAM_ALLOWED_USER_IDS`.

Set:

```bash
ENABLE_TELEGRAM_NOTIFICATIONS=true
TELEGRAM_BOT_TOKEN=replace-with-token
TELEGRAM_ALLOWED_USER_IDS='[
  123456789
]'
TELEGRAM_E2E_ENABLED=true
TELEGRAM_TEST_SEND_DELAY_MS=3000
```

Send real test messages:

```bash
npm run telegram:test-send
```

Expected result: each configured Telegram user receives multiple governance notification messages based on locally saved Lido, Aave, and Uniswap proposal samples. Messages start with bold all-caps `NEW GOVERNANCE ITEM TRACKED`.

Run the real Telegram E2E test:

```bash
npm run test:e2e:telegram
```

Expected result: pending proposals are seeded in memory, sent through the real Telegram service, and marked `sent`.

Normal `npm test` and `npm run check` do not send Telegram messages. The live E2E path only runs through this dedicated command.

## 10. Daily Admin Status

The admin status report is a separate daily Telegram message for the operator. It uses the same bot token as proposal notifications, but sends only to `TELEGRAM_ADMIN_USER_ID`.

Set:

```bash
ENABLE_ADMIN_STATUS_REPORTS=true
TELEGRAM_ADMIN_USER_ID=1549323073
ADMIN_STATUS_CRON=0 9 * * *
ENABLE_SCHEDULER=true
ENABLE_SOURCE_ACTIVITY_ALERTS=true
SOURCE_ACTIVITY_WARNING_DAYS=14
SOURCE_ACTIVITY_CRITICAL_DAYS=30
SOURCE_ACTIVITY_MIN_FETCHED_COUNT=1
```

Expected result: once per day at `09:00` server time, the admin receives a compact status message with latest fetch results, source-activity freshness, pending/failed notification counts, enabled protocols, and any detected problems.

One-off demo command:

```bash
npm run demo:admin
```

## 11. Tests

Run all normal tests:

```bash
npm test
```

Run full verification:

```bash
npm run check
```

Expected result: build passes, strict typecheck passes, and all unit/integration tests pass. Normal tests use fixtures/mocks and do not call live forums or Telegram.

Watch mode:

```bash
npm run test:watch
```

## 12. Firestore Run

Set:

```bash
NODE_ENV=production
STORAGE_MODE=firestore
DEMO_MODE=false
ENABLE_SCHEDULER=true
FETCH_INTERVAL_CRON=0 8 * * *
ENABLE_SOURCE_ACTIVITY_ALERTS=true
SOURCE_ACTIVITY_WARNING_DAYS=14
SOURCE_ACTIVITY_CRITICAL_DAYS=30
SOURCE_ACTIVITY_MIN_FETCHED_COUNT=1
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

Expected result: proposals are stored in Firestore `proposals`, fetch runs are stored in Firestore `fetchRuns`, source freshness is stored in Firestore `sourceActivity`, and the scheduler polls enabled protocols once daily at `08:00` server time by default. The admin status report runs at `09:00`, giving the daily fetch time to complete first.

## 13. Docker

Build the production image:

```bash
docker build -t governance-tracker-bot .
```

Run the production container with runtime env vars:

```bash
docker run -d \
  -p 3000:3000 \
  --name governance-tracker-bot \
  --restart unless-stopped \
  -e NODE_ENV=production \
  -e STORAGE_MODE=firestore \
  -e DEMO_MODE=false \
  -e ENABLE_SCHEDULER=true \
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
  governance-tracker-bot
```

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

## 14. What No Longer Exists

The platform no longer exposes dashboard-oriented endpoints:

```text
GET /api/proposals
GET /api/proposals/:id
GET /api/proposals/source/:protocol/:sourceType/:sourceId
GET /api/protocols
GET /api/debug/*
```

To inspect proposals in production, use the Firestore `proposals` collection. To inspect proposals during a demo, use `npm run demo`, which prints the repository snapshot directly.

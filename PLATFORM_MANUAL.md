# Platform Manual

Quick operator guide for the Lido, Aave, Uniswap, and CoW DAO governance monitor. The service polls governance forums, filters by trusted publishers, stores new proposals, sends direct Telegram alerts, retries failed recipients automatically, and reports source and system health to the Telegram admin.

Detailed architecture and configuration are in [README.md](./README.md).

```bash
API=http://localhost:3000
```

Use Node.js 22 or newer locally. The production Docker image uses Node.js 24 LTS.

## Preflight

Run before every production deployment:

```bash
npm install
npm run check
DEMO_STEP_DELAY_MS=0 npm run demo
docker build -t governance-tracker-bot .
```

Expected:

- TypeScript build and strict typecheck pass.
- All normal unit, regression, repository, and API integration tests pass.
- Coverage remains above the enforced global thresholds.
- The live Telegram E2E test remains skipped unless explicitly requested.
- The credential-free demo completes for Lido, Aave, Uniswap, and CoW.
- The production Docker image builds.

## Local Start

Use these `.env` values for a credential-free local API:

```bash
NODE_ENV=development
PORT=3000
STORAGE_MODE=memory
DEMO_MODE=true
ENABLE_SCHEDULER=false
API_AUTH_ENABLED=false
ENABLE_TELEGRAM_NOTIFICATIONS=false
ENABLE_ADMIN_STATUS_REPORTS=false
LOG_LEVEL=info
```

Start:

```bash
NODE_ENV=development \
STORAGE_MODE=memory \
DEMO_MODE=true \
ENABLE_SCHEDULER=false \
ENABLE_TELEGRAM_NOTIFICATIONS=false \
ENABLE_ADMIN_STATUS_REPORTS=false \
API_AUTH_ENABLED=false \
npm run dev
```

Memory-mode data exists only inside this process and disappears on restart.

## Terminal Demo

Normal walkthrough:

```bash
DEMO_STEP_DELAY_MS=750 npm run demo
```

Fast walkthrough:

```bash
DEMO_STEP_DELAY_MS=0 npm run demo
```

The demo uses locally saved real forum samples and memory storage. It shows:

- Lido, Aave, Uniswap, and CoW using the shared fetch pipeline.
- Protocol-specific publisher allowlists.
- Non-allowlisted topics being skipped.
- New allowlisted proposals being normalized and stored.
- Duplicate topics not creating duplicate records.
- Unchanged topics not causing Firestore-style write churn.
- Fetch-run audit records.
- Silent-migration source-activity records.
- Notification status and masked per-recipient delivery state.

The scripted demo begins from an established baseline so its revealed fixtures behave like genuinely new discoveries. It never requires Firebase.

If Telegram proposal notifications are enabled, demo messages are forced to `TELEGRAM_ADMIN_USER_ID` only. Production recipients in `TELEGRAM_ALLOWED_USER_IDS` are not used by the demo.

Send the final admin health report during the demo:

```bash
npm run demo:admin
```

## API Checks

### Health

```bash
curl -s "$API/health"
```

Expected:

```json
{
  "ok": true,
  "storageMode": "memory",
  "schedulerEnabled": false
}
```

This reads runtime state only. It does not call a forum.

### Manual Fetch

```bash
curl -s -X POST "$API/api/admin/fetch/lido"
curl -s -X POST "$API/api/admin/fetch/aave"
curl -s -X POST "$API/api/admin/fetch/uniswap"
curl -s -X POST "$API/api/admin/fetch/cow"
```

Each call runs the same pipeline as the scheduler. Production mode calls the live forum; memory/demo mode uses local samples.

Important result fields:

- `fetchedCount`: unique raw topics inspected.
- `allowlistedCount`: topics matching the protocol publisher allowlist.
- `storedNewCount`: allowlisted proposals inserted for the first time.
- `baselineSeededCount`: historical proposals stored silently during first-run seeding or after an allowlist expansion.
- `updatedExistingCount`: known proposals with meaningful source changes.
- `unchangedExistingCount`: known identical proposals not rewritten.
- `skippedCount`: non-allowlisted topics.
- `notificationSentCount`: newly discovered proposals delivered during this fetch.
- `notificationFailedCount`: newly discovered proposals with at least one initial recipient failure.
- `errors`: non-fatal notification errors, or the persisted failure reason for a failed run.

On an empty database, the first successful fetch for each protocol that meets `SOURCE_ACTIVITY_MIN_FETCHED_COUNT` establishes a silent baseline. Historical allowlisted proposals are stored with notifications skipped. An empty or interrupted first fetch remains in seeding mode; later discoveries notify only after a valid baseline completes.

When a publisher is added to an established allowlist, any of that publisher's topics dated at or before the previous successful protocol poll are stored silently instead of producing historical alerts. Topics newer than the previous successful poll notify normally.

### Fetch Runs

```bash
curl -s "$API/api/admin/fetch-runs"
```

Expected: newest stored fetch-run audit records. This reads Firestore or memory and does not call forums.

### Source Activity

```bash
curl -s "$API/api/admin/source-activity"
```

Expected: one latest source-activity record per fetched protocol. The watchdog evaluates all raw topics before allowlist filtering, allowing it to flag an old forum that still responds but no longer receives activity.

### Admin Status

```bash
curl -s -X POST "$API/api/admin/status/send"
```

Expected: the configured Telegram admin receives the same status report used by the daily cron. The response contains `sent`, `healthy`, and `problems`.

The report shows:

- Latest fetch status per enabled protocol.
- Current exact pending and failed proposal counts.
- Masked failed recipient IDs, attempts, next retry time, and last error.
- Raw source freshness and silent-migration warnings.
- Enabled protocols with an empty publisher allowlist.
- Storage and scheduler mode.

Historical fetch failures remain in `fetchRuns`, but they do not keep the current report unhealthy after the latest run and proposal delivery state recover.

## Automatic Notification Recovery

There is no manual retry or acknowledgement endpoint.

With `ENABLE_SCHEDULER=true` and `ENABLE_TELEGRAM_NOTIFICATIONS=true`, `NOTIFICATION_RETRY_CRON` checks unresolved deliveries every 15 minutes by default.

Retry delays are:

- First failure: 15 minutes.
- Second failure: 1 hour.
- Third failure: 6 hours.
- Later failures: 24 hours.

Only failed or pending recipients are retried. A recipient already marked `sent` never receives that proposal again. A failed proposal clears automatically after all remaining recipients succeed. Removing an unresolved recipient from `TELEGRAM_ALLOWED_USER_IDS` marks that delivery skipped and also allows the aggregate status to clear. Ambiguous failures created by an older release without verifiable recipient identity are closed as `skipped` without resending.

The monitor accepts delivery only after Telegram returns valid JSON with `ok: true`. A misleading HTTP `2xx` proxy page, malformed response, empty response, or Telegram `ok: false` response stays unresolved and is retried automatically.

The daily admin report continues to say `ATTENTION REQUIRED` while unresolved state remains.

## API Auth

When enabled, every endpoint requires the token:

```bash
API_AUTH_ENABLED=true
API_AUTH_TOKEN=replace-with-long-random-secret
```

When API auth is enabled, the process fails at startup if the token is blank.
Surrounding whitespace in the configured token is ignored.

```bash
curl -s "$API/health" \
  -H "Authorization: Bearer $API_AUTH_TOKEN"
```

Without a token, expect `401`. With the wrong token, expect `403`. Use HTTPS whenever the API is reachable over a network.

## Telegram Tests

Every direct-message recipient must open the bot and send `/start` once.

Production proposal notifications fan out to every ID in `TELEGRAM_ALLOWED_USER_IDS`.

The production message remains:

```text
NEW GOVERNANCE ITEM TRACKED
Protocol: <protocol>
Source: <source type>
Publisher: <publisher>
Title: <title>
Link: <source URL>
```

The heading is bold and all caps.

Test and demo messages go only to `TELEGRAM_ADMIN_USER_ID`:

```bash
TELEGRAM_E2E_ENABLED=true
TELEGRAM_TEST_SEND_DELAY_MS=3000
npm run telegram:test-send
```

Expected: the admin receives real Lido, Aave, Uniswap, and CoW sample notifications with three seconds between messages. Teammate production recipients are not contacted.

Real Telegram E2E:

```bash
npm run test:e2e:telegram
```

Expected: proposals are inserted into a memory repository, delivered to the admin only, and verified as `sent`.

`npm test` and `npm run check` never send live Telegram messages.

## Scheduled Production Flow

Default schedule:

```bash
FETCH_INTERVAL_CRON="0 8 * * *"
NOTIFICATION_RETRY_CRON="*/15 * * * *"
ADMIN_STATUS_CRON="0 9 * * *"
```

At `08:00`, all enabled protocols fetch. Every 15 minutes, unresolved notification recipients are retried when due. At `09:00`, the admin receives current system health.

Cron uses the container/server timezone. Run only one scheduler-enabled replica where practical to avoid duplicate polling and audit runs.

Forum requests retry transient network failures, timeouts, and `408`, `429`, or `5xx` responses up to three attempts. Invalid JSON and definitive client errors are not retried. If a later page or one redundant Aave/Uniswap/CoW category feed fails after recent topics were obtained, the monitor preserves the usable data and continues. A protocol run fails when no usable governance feed can be read.

## Tests

Run all normal tests:

```bash
npm test
```

Run the complete local quality gate:

```bash
npm run check
```

`npm run check` runs the production build, strict unused-symbol typecheck, and every normal Jest/Supertest test.

`npm test` also collects coverage and fails below 97% statements, 88% branches, 96% functions, or 97% lines. It never sends live Telegram messages.

Watch mode:

```bash
npm run test:watch
```

## Docker Production

Build:

```bash
docker build -t governance-tracker-bot .
```

The production container runs as the non-root `node` user.

Run with the production `-e` values documented in the README:

```bash
docker run -d \
  -p 127.0.0.1:3001:3000 \
  --name governance-tracker-bot \
  --restart unless-stopped \
  [runtime -e variables...] \
  governance-tracker-bot
```

Current CoW publisher configuration:

```bash
-e COW_ALLOWED_PUBLISHERS='["notsoformal","Kowrigan","harisang","felixhenneke","KPK"]' \
```

Binding to `127.0.0.1:3001` keeps the API local to the droplet while scheduled polling and outbound Telegram notifications continue normally.

Do not use the local pretty multi-line `.env` directly with `--env-file`; Docker requires every value, including JSON publisher arrays, on one physical line.

Useful commands:

```bash
docker ps -a
docker images
docker logs -f governance-tracker-bot
docker restart governance-tracker-bot
docker stop governance-tracker-bot
docker rm governance-tracker-bot
docker image prune
```

## Firestore

Production structured state:

- `proposals/{proposalId}`: normalized proposals and recipient delivery state.
- `fetchRuns/{runId}`: immutable operational audit history.
- `sourceActivity/{protocol}`: latest raw forum activity and watchdog state.
- `protocolState/{protocol}`: cold-start baseline state.

No Firebase Storage archive is used.

The monitor’s notification count and failure-detail queries use single-field Firestore queries and aggregate counts; no custom composite index is required for the admin status report.

## Removed Surfaces

The monitor has no dashboard, public proposal browser, debug API, manual notification retry endpoint, or manual failed-notification acknowledgement endpoint. Inspect production proposals directly in Firestore and use the operational endpoints above for health and audit data.

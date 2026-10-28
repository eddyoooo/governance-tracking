# Platform Manual

Quick operator guide for the governance monitor. It tracks trusted Lido, Aave, Uniswap, and CoW forum topics plus Uniswap Governor Bravo proposal lifecycles on Ethereum mainnet, stores structured state, sends direct Telegram alerts, retries failed recipients, and reports health to the Telegram admin. Forum trust is based on protocol publisher-name allowlists; Lido additionally accepts original posters with Discourse Leader level (`trust_level=4`).

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
npm run audit:prod
ENABLE_TELEGRAM_NOTIFICATIONS=false DEMO_STEP_DELAY_MS=0 npm run demo
docker build --load -t governance-tracker-bot .
```

Expected:

- TypeScript build and strict typecheck pass.
- All normal unit, regression, repository, and API integration tests pass.
- Coverage remains above the enforced global thresholds.
- The production dependency set reports no known npm vulnerabilities.
- The live Telegram E2E test remains skipped unless explicitly requested.
- The credential-free demo completes for all four forums and the Uniswap on-chain lifecycle.
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
UNISWAP_ONCHAIN_ENABLED=false
UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED=false
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
UNISWAP_ONCHAIN_ENABLED=false \
UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED=false \
API_AUTH_ENABLED=false \
npm run dev
```

Memory-mode data exists only inside this process and disappears on restart.
All four forum adapters, including CoW, are enabled by default. Set a protocol's `*_ENABLED=false` only when intentionally pausing that source. Enablement controls polling; only topics matching that protocol's publisher policy are stored and notified. Lido's policy also accepts Leader-level original authors; the other forum policies are name-allowlist-only.

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
- Real saved Uniswap proposal `#100` data replayed through creation, vote success, queue, and execution.
- Silent on-chain baseline seeding and a repeated scan that creates no duplicate decision, event, or alert. The concise proposal #100 demo displays the captured seven-action total and includes its first action as a sample; production stores every action returned by the Governor.

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
  "schedulerEnabled": false,
  "forumGovernance": {
    "enabledProtocols": ["lido", "aave", "uniswap", "cow"],
    "schedule": "0 8 * * *"
  },
  "onchainGovernance": {
    "enabledProtocols": [],
    "schedule": "0 */6 * * *"
  }
}
```

This reads runtime state only. It does not call a forum. Confirm that `cow` appears in `forumGovernance.enabledProtocols` unless CoW was intentionally disabled.

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
- `allowlistedCount`: topics matching the protocol publisher policy. For Lido this includes configured publisher names and Leader-level original authors; for the other forums it means name-allowlist matches only.
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

For Lido, only the topic's original poster can qualify through the Leader exemption. A Leader reply or last commenter does not affect filtering. The category JSON supplies the original author's trust level, so the normal fetch does not make one additional request per topic.

On the first deployment of this policy, previously seen Leader-authored history is saved silently. A Leader topic newer than the last successful Lido poll is treated as a normal new proposal and can notify recipients.

### Uniswap On-chain Scan

Production configuration:

```bash
ETHEREUM_RPC_URL=https://replace-with-authenticated-ethereum-mainnet-rpc
UNISWAP_ONCHAIN_ENABLED=true
UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED=true
ONCHAIN_FETCH_INTERVAL_CRON="0 */6 * * *"
UNISWAP_GOVERNOR_ADDRESS=0x408ED6354d4973f66138C91495F2f2FCbd8724C3
UNISWAP_TIMELOCK_ADDRESS=0x1a9C8182C09F50C8318d769245beA52c32BE35BC
UNISWAP_UNI_TOKEN_ADDRESS=0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984
```

Run one scan after deployment:

```bash
curl -s -X POST "$API/api/admin/fetch-onchain/uniswap"
```

The first scan silently replays finalized Governor history in resumable 10,000-block ranges. It may require roughly 1,300 RPC log requests and take several minutes. A successful response has `status: "success"`; historical lifecycle events are `skipped`, not sent.

Important result fields:

- `baselineSeeding`: whether this run belongs to the silent historical baseline.
- `cursorBefore` / `cursorAfter`: finalized block coverage persisted before and after the run.
- `rangesScanned` / `contractEventsRead`: RPC coverage and matching lifecycle logs.
- `decisionsCreated` / `decisionsUpdated` / `decisionsUnchanged`: proposal persistence results.
- `lifecycleEventsCreated`: new deterministic lifecycle transitions stored.
- `notificationSentCount` / `notificationFailedCount`: lifecycle messages delivered or initially failed.
- `errors`: fail-closed validation, coverage, RPC, persistence, or delivery errors.

Inspect stored state:

```bash
curl -s "$API/api/admin/onchain-source-status"
curl -s "$API/api/admin/onchain-scan-runs?limit=10"
curl -s "$API/api/admin/governance-votes?protocol=uniswap&limit=10"
```

Expected after baseline: source status shows `baselineStatus: "complete"` and `healthStatus: "healthy"`; scan runs are newest first; governance votes contain stored proposal status, vote totals, proposer, actions, and lifecycle transaction references. These three GETs read Firestore or memory and do not call the RPC.

The scanner pins validation and proposal reads to one finalized block, validates Ethereum mainnet, Governor/Timelock/UNI contract relationships, bytecode, the configured Governor implementation, finalized cursor hash, proposal-counter continuity, complete proposal-id coverage, and canonical lifecycle block/transaction references. It refreshes aggregate `for`, `against`, and `abstain` totals for every proposal that can still transition, including defeated or expired proposals that may later be canceled; it does not store individual voter ballots. Legacy Governor Alpha proposal IDs `1..8` are excluded using the Governor's `initialProposalId`; Bravo tracking starts at `#9`. Inconsistent or regressive RPC data, a missing proposal, or an incomplete lifecycle fails the scan and appears in the daily admin report rather than silently advancing.

A missing or corrupt historical baseline record is repaired by a silent full replay. A missing post-baseline proposal or lifecycle reference rewinds for a notification-enabled full replay; the persisted replay mode survives restarts, and deterministic IDs prevent known lifecycle alerts from being resent while allowing a missed event to notify. A queued-then-canceled proposal retains both canonical lifecycle stages. Governor Bravo may emit repeated cancellation logs; the first cancellation is canonical and later repeats do not create another alert.

The implementation guard detects upgrades of the configured Governor Bravo proxy. A move to a separate Governor address requires an explicit configuration change and code review; an unchanged legacy contract cannot identify its replacement automatically.

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
- Uniswap on-chain baseline progress, cursor/finalized head, source health, latest scan, and unresolved lifecycle deliveries.
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

On-chain lifecycle alerts keep the same concise style. The protocol value is uppercase and bold. Result messages report status, the exact voting-end time in UTC, aggregate `For`, `Against`, and `Abstain` UNI totals, title, and link. Source type, proposal number, proposer, actions, and block references remain stored but are omitted from Telegram. Existing forum message text is unchanged.

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

Expected: forum samples and one real Uniswap vote-result sample are inserted into memory repositories, delivered to the admin only, and verified as `sent`.

Read-only live forum E2E:

```bash
npm run test:e2e:forums
```

Expected: Lido, Aave, Uniswap, and CoW return schema-valid recent topics; Aave, Uniswap, and CoW also return valid public category metadata. Firestore and Telegram are not used.

Read-only live Uniswap RPC E2E:

```bash
npm run test:e2e:onchain
```

Expected: the configured mainnet contracts validate and known proposal #100's lifecycle logs, vote totals, and seven actions match the saved fixture. This command uses neither Firestore nor Telegram.

Deep read-only full-history audit (many RPC requests):

```bash
npm run test:e2e:onchain:full
```

Expected: every Governor Bravo proposal is replayed into memory without ID gaps or duplicate decisions, with canonical lifecycle references and voting-end timestamps verified. Firestore and Telegram are forcibly disabled. Allow 10-30 minutes when the RPC provider throttles historical requests.

`npm test` and `npm run check` never call the live RPC or send live Telegram messages.

## Scheduled Production Flow

Default schedule:

```bash
FETCH_INTERVAL_CRON="0 8 * * *"
FETCH_RUN_MAX_AGE_HOURS=48
ONCHAIN_FETCH_INTERVAL_CRON="0 */6 * * *"
NOTIFICATION_RETRY_CRON="*/15 * * * *"
ADMIN_STATUS_CRON="0 9 * * *"
```

At `08:00`, all enabled forums fetch. At `00:00`, `06:00`, `12:00`, and `18:00`, enabled on-chain sources scan finalized blocks. Every 15 minutes, unresolved forum and lifecycle recipients are retried when due. At `09:00`, the admin receives current system health. Cron uses the container/server timezone.

The daily status changes to `ATTENTION REQUIRED` when an enabled on-chain source has no successful scan in the preceding 12 hours, even if its last stored cursor and health flag still look normal.
In production, it also flags a forum whose most recent successful fetch is older than `FETCH_RUN_MAX_AGE_HOURS` (48 hours by default), including when the scheduler stops running.

During the initial Uniswap historical baseline, the daily status also remains `ATTENTION REQUIRED` until seeding is complete. It reports checkpointed and remaining blocks, percentage complete, the persisted resume position, last attempt, last successful scan, consecutive failures, latest scan status, and replay mode. Historical alerts stay suppressed during this phase. A live coverage repair is reported explicitly and remains notification-enabled, while deterministic IDs prevent duplicate alerts. If a scan fails or the container restarts, the status keeps the interruption visible and the next scan resumes from the reported checkpoint.

Run only one scheduler-enabled replica where practical to avoid duplicate polling and audit runs.

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

Audit the exact production dependency set:

```bash
npm run audit:prod
```

Watch mode:

```bash
npm run test:watch
```

## Docker Production

Build:

```bash
docker build --load -t governance-tracker-bot .
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

For Uniswap on-chain tracking, include the seven RPC/on-chain `-e` values from the README. After deployment, manually run the first scan and monitor logs until `/api/admin/onchain-source-status` reports `baselineStatus: "complete"`. The historical baseline is silent and resumable.

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
- `governanceDecisions/{decisionId}`: Uniswap on-chain proposal, vote, action, and lifecycle state.
- `governanceEvents/{eventId}`: deterministic lifecycle event and masked recipient delivery state.
- `governanceSourceStates/{sourceKey}`: resumable finalized cursor, Alpha/Bravo proposal boundary, fixed baseline count, implementation, and source health.
- `governanceScanRuns/{runId}`: on-chain scan audit history.

No Firebase Storage archive is used.

The monitor’s notification count and failure-detail queries use single-field Firestore queries and aggregate counts; no custom composite index is required for the admin status report or on-chain lifecycle recovery.

## Removed Surfaces

The monitor has no dashboard, public forum-proposal browser, debug API, manual notification retry endpoint, or manual failed-notification acknowledgement endpoint. Inspect forum proposals directly in Firestore; the on-chain read endpoints exist only for operator verification and audit.

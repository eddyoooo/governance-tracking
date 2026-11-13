import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "@jest/globals";

const execute = promisify(execFile);

describe("complete credential-free demo", () => {
  it("exercises all four forums and both on-chain lifecycles with no real services", async () => {
    const { stdout, stderr } = await execute(process.execPath, ["--import", "tsx", "src/demo.ts"], {
      cwd: new URL("../..", import.meta.url),
      timeout: 30_000,
      maxBuffer: 1_000_000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        STORAGE_MODE: "memory",
        DEMO_MODE: "true",
        FIREBASE_PROJECT_ID: "",
        FIREBASE_CLIENT_EMAIL: "",
        FIREBASE_PRIVATE_KEY: "",
        ETHEREUM_RPC_URL: "https://demo.invalid/rpc",
        LIDO_ENABLED: "true",
        AAVE_ENABLED: "true",
        UNISWAP_ENABLED: "true",
        COW_ENABLED: "true",
        UNISWAP_ONCHAIN_ENABLED: "false",
        UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED: "false",
        AAVE_ONCHAIN_ENABLED: "false",
        AAVE_ONCHAIN_NOTIFICATIONS_ENABLED: "false",
        ENABLE_TELEGRAM_NOTIFICATIONS: "false",
        TELEGRAM_BOT_TOKEN: "",
        TELEGRAM_ALLOWED_USER_IDS: "[]",
        TELEGRAM_E2E_ENABLED: "false",
        ENABLE_ADMIN_STATUS_REPORTS: "false",
        ENABLE_ADMIN_DEMO: "false",
        ENABLE_SCHEDULER: "false",
        API_AUTH_ENABLED: "false",
        API_AUTH_TOKEN: "",
        LOG_LEVEL: "silent",
        DEMO_STEP_DELAY_MS: "0"
      }
    });

    expect(stderr).toBe("");
    expect(stdout).toContain("Telegram is disabled");
    expect(stdout).toContain("https://vote.uniswapfoundation.org/proposals/100");
    expect(stdout).not.toContain("vote.onaave.com");
    const marker = "\nSummary\n";
    expect(stdout).toContain(marker);
    const summary = JSON.parse(stdout.slice(stdout.lastIndexOf(marker) + marker.length));
    expect(summary).toMatchObject({
      storedProposalCount: 18,
      fetchRunCount: 10,
      sourceActivityCount: 4,
      telegram: "disabled for this run",
      aave: { firstFetch: { notificationSuppressedCount: 2 } },
      uniswapOnchain: {
        baseline: { status: "success", baselineSeeding: true, notificationSentCount: 0 },
        creation: { decisionsCreated: 1, lifecycleEventsCreated: 1 },
        execution: { lifecycleEventsCreated: 3, notificationFailedCount: 0 },
        duplicate: { lifecycleEventsCreated: 0, notificationSentCount: 0 },
        storedDecisionCount: 1
      },
      aaveOnchain: {
        baseline: { status: "success", baselineSeeding: true, notificationSentCount: 0 },
        creation: { decisionsCreated: 1, lifecycleEventsCreated: 1, notificationSentCount: 0 },
        execution: { lifecycleEventsCreated: 3, notificationSentCount: 0, notificationFailedCount: 0 },
        duplicate: { lifecycleEventsCreated: 0, notificationSentCount: 0 },
        storedDecisionCount: 1,
        sourceUrl: "https://app.aave.com/governance/v3/proposal/?proposalId=0",
        integrityChecks: "passed"
      }
    });
    for (const protocol of ["aave", "uniswap", "cow"]) {
      expect(summary[protocol].duplicateFetch).toMatchObject({ storedNewCount: 0, notificationSentCount: 0 });
    }
    expect(summary.lidoDuplicateFetch).toMatchObject({ storedNewCount: 0, unchangedExistingCount: 3 });
  }, 35_000);
});

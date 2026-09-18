import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  engines: Record<string, string>;
  overrides: Record<string, Record<string, string>>;
};

describe("package scripts", () => {
  it("keeps the admin status demo explicitly opt in", () => {
    expect(packageJson.scripts.demo).toBe("tsx src/demo.ts");
    expect(packageJson.scripts["demo:admin"]).toBe(
      "ENABLE_ADMIN_DEMO=true tsx src/demo.ts"
    );
  });

  it("keeps normal tests comprehensive and live external E2E checks explicitly separate", () => {
    expect(packageJson.scripts.test).toContain("jest.js --runInBand");
    expect(packageJson.scripts.test).not.toContain("RUN_TELEGRAM_E2E");
    expect(packageJson.scripts.test).not.toContain("RUN_FORUM_E2E");
    expect(packageJson.scripts.test).not.toContain("RUN_UNISWAP_ONCHAIN_E2E");
    expect(packageJson.scripts.test).not.toContain(
      "RUN_UNISWAP_ONCHAIN_FULL_E2E"
    );
    expect(packageJson.scripts["test:e2e:onchain"]).toContain(
      "RUN_UNISWAP_ONCHAIN_E2E=true"
    );
    expect(packageJson.scripts["test:e2e:forums"]).toContain(
      "RUN_FORUM_E2E=true"
    );
    expect(packageJson.scripts["test:e2e:forums"]).toContain(
      "--coverage=false"
    );
    expect(packageJson.scripts["test:e2e:onchain"]).toContain(
      "--coverage=false"
    );
    expect(packageJson.scripts["test:e2e:onchain:full"]).toContain(
      "RUN_UNISWAP_ONCHAIN_FULL_E2E=true"
    );
    expect(packageJson.scripts["test:e2e:onchain:full"]).toContain(
      "--coverage=false"
    );
    expect(packageJson.scripts["test:e2e:telegram"]).toContain(
      "RUN_TELEGRAM_E2E=true"
    );
    expect(packageJson.scripts["test:e2e:telegram"]).toContain(
      "TELEGRAM_E2E_ENABLED=true"
    );
    expect(packageJson.scripts["test:e2e:telegram"]).toContain(
      "--coverage=false"
    );
    expect(packageJson.scripts["test:watch"]).toContain("--coverage=false");
  });

  it("uses a Firebase Admin release compatible with the supported production runtime", () => {
    expect(packageJson.dependencies["firebase-admin"]).toBe("^14.4.0");
    expect(packageJson.dependencies["@google-cloud/firestore"]).toBe("^9.1.0");
    expect(packageJson.engines.node).toBe(">=22.0.0");
  });

  it("retains the patched production Firestore dependency override", () => {
    expect(packageJson.overrides["google-gax"]).toEqual({
      rimraf: "6.1.3"
    });
  });

  it("audits the same dependency set installed in the production image", () => {
    expect(packageJson.scripts["audit:prod"]).toBe(
      "npm audit --omit=dev --omit=optional"
    );
  });
});

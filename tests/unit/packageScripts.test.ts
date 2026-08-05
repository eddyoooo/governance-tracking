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

  it("keeps normal tests comprehensive and live Telegram delivery explicitly separate", () => {
    expect(packageJson.scripts.test).toContain("jest.js --runInBand");
    expect(packageJson.scripts.test).not.toContain("RUN_TELEGRAM_E2E");
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
    expect(packageJson.dependencies["firebase-admin"]).toBe("^14.2.0");
    expect(packageJson.engines.node).toBe(">=22.0.0");
  });

  it("retains the patched production Firestore dependency override", () => {
    expect(packageJson.overrides["google-gax"]).toEqual({
      rimraf: "6.1.3"
    });
  });
});

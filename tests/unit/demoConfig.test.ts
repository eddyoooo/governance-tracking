import { describe, expect, it } from "@jest/globals";
import {
  readBooleanFlag,
  shouldEnableAdminStatusDemo,
  telegramAllowedUserIdsForDemo,
  telegramAdminUserIdForDemo
} from "../../src/demoConfig.js";

describe("demo config", () => {
  it("parses explicit truthy demo flags", () => {
    expect(readBooleanFlag("FLAG", { FLAG: "true" })).toBe(true);
    expect(readBooleanFlag("FLAG", { FLAG: " TRUE " })).toBe(true);
    expect(readBooleanFlag("FLAG", { FLAG: "1" })).toBe(true);
    expect(readBooleanFlag("FLAG", { FLAG: "yes" })).toBe(true);
  });

  it("treats missing or non-truthy demo flags as disabled", () => {
    expect(readBooleanFlag("FLAG", {})).toBe(false);
    expect(readBooleanFlag("FLAG", { FLAG: "" })).toBe(false);
    expect(readBooleanFlag("FLAG", { FLAG: "false" })).toBe(false);
    expect(readBooleanFlag("FLAG", { FLAG: "0" })).toBe(false);
    expect(readBooleanFlag("FLAG", { FLAG: "no" })).toBe(false);
  });

  it("enables admin demo only through ENABLE_ADMIN_DEMO", () => {
    expect(
      shouldEnableAdminStatusDemo({
        ENABLE_ADMIN_STATUS_REPORTS: "true"
      })
    ).toBe(false);
    expect(
      shouldEnableAdminStatusDemo({
        ENABLE_ADMIN_DEMO: "true",
        ENABLE_ADMIN_STATUS_REPORTS: "false"
      })
    ).toBe(true);
  });

  it("forces demo Telegram proposal notifications to the configured admin user only", () => {
    const source = {
      TELEGRAM_ADMIN_USER_ID: " 1549323073 ",
      TELEGRAM_ALLOWED_USER_IDS: JSON.stringify(["111111111", "222222222"])
    };

    expect(telegramAdminUserIdForDemo(source)).toBe("1549323073");
    expect(telegramAllowedUserIdsForDemo(source)).toBe(
      JSON.stringify(["1549323073"])
    );
    expect(telegramAllowedUserIdsForDemo(source)).not.toContain("111111111");
    expect(telegramAllowedUserIdsForDemo(source)).not.toContain("222222222");
  });

  it("uses the production admin user id default for demo safety", () => {
    expect(telegramAdminUserIdForDemo({})).toBe("1549323073");
    expect(telegramAllowedUserIdsForDemo({})).toBe(
      JSON.stringify(["1549323073"])
    );
  });
});

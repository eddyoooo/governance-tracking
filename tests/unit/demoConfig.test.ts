import { describe, expect, it } from "@jest/globals";
import {
  readBooleanFlag,
  shouldEnableAdminStatusDemo
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
});

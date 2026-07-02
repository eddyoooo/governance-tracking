import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as {
  scripts: Record<string, string>;
};

describe("package scripts", () => {
  it("keeps the admin status demo explicitly opt in", () => {
    expect(packageJson.scripts.demo).toBe("tsx src/demo.ts");
    expect(packageJson.scripts["demo:admin"]).toBe(
      "ENABLE_ADMIN_DEMO=true tsx src/demo.ts"
    );
  });
});

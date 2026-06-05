import { describe, expect, it } from "@jest/globals";
import { createProtocolRegistry, ProtocolRegistry } from "../../src/protocols/registry.js";
import { createFakeProtocolAdapter, createSilentLogger, testEnv } from "../helpers/builders.js";

describe("ProtocolRegistry", () => {
  it("registers, retrieves, and lists protocol adapters", () => {
    const registry = new ProtocolRegistry();
    const lido = createFakeProtocolAdapter({ protocol: "lido" });
    const aave = createFakeProtocolAdapter({ protocol: "aave" });

    registry.register(lido);
    registry.register(aave);

    expect(registry.get("lido")).toBe(lido);
    expect(registry.get("aave")).toBe(aave);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.list()).toEqual([lido, aave]);
  });

  it("replaces adapters registered with the same protocol key", () => {
    const registry = new ProtocolRegistry();
    const first = createFakeProtocolAdapter({
      protocol: "lido",
      publisherAllowlist: ["First"]
    });
    const second = createFakeProtocolAdapter({
      protocol: "lido",
      publisherAllowlist: ["Second"]
    });

    registry.register(first);
    registry.register(second);

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("lido")).toBe(second);
  });

  it("creates the Lido registry from environment configuration", () => {
    const registry = createProtocolRegistry(
      testEnv({
        LIDO_ENABLED: "false",
        LIDO_FORUM_BASE_URL: "https://research.lido.fi",
        LIDO_FORUM_API_BASE_URL: "https://research.lido.fi",
        LIDO_ALLOWED_PUBLISHERS: JSON.stringify(["Allowed Publisher", "DAO Ops"])
      }),
      createSilentLogger()
    );

    const lido = registry.get("lido");

    expect(lido).toBeDefined();
    expect(lido).toMatchObject({
      protocol: "lido",
      enabled: false,
      publisherAllowlist: ["Allowed Publisher", "DAO Ops"],
      source: {
        protocol: "lido",
        type: "forum",
        name: "Lido Research Forum",
        baseUrl: "https://research.lido.fi"
      }
    });
  });
});

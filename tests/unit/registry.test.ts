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

  it("creates the protocol registry from environment configuration", () => {
    const registry = createProtocolRegistry(
      testEnv({
        LIDO_ENABLED: "false",
        LIDO_FORUM_BASE_URL: "https://research.lido.fi",
        LIDO_FORUM_API_BASE_URL: "https://research.lido.fi",
        LIDO_ALLOWED_PUBLISHERS: JSON.stringify(["Allowed Publisher", "DAO Ops"]),
        AAVE_ENABLED: "false",
        AAVE_FORUM_BASE_URL: "https://governance.aave.com",
        AAVE_FORUM_API_BASE_URL: "https://governance.aave.com",
        AAVE_ALLOWED_PUBLISHERS: JSON.stringify([
          "AaveLabs",
          "TokenLogic",
          "LlamaRisk"
        ])
      }),
      createSilentLogger()
    );

    const lido = registry.get("lido");
    const aave = registry.get("aave");

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
    expect(aave).toBeDefined();
    expect(aave).toMatchObject({
      protocol: "aave",
      enabled: false,
      publisherAllowlist: ["AaveLabs", "TokenLogic", "LlamaRisk"],
      source: {
        protocol: "aave",
        type: "forum",
        name: "Aave Governance Forum",
        baseUrl: "https://governance.aave.com"
      }
    });
  });

  it("uses fixture-backed protocol fetching in demo or memory mode", async () => {
    const registry = createProtocolRegistry(
      testEnv({
        STORAGE_MODE: "memory",
        DEMO_MODE: "true",
        LIDO_ALLOWED_PUBLISHERS: JSON.stringify(["Allowed Publisher"]),
        AAVE_ALLOWED_PUBLISHERS: JSON.stringify([
          "AaveLabs",
          "TokenLogic",
          "LlamaRisk"
        ])
      }),
      createSilentLogger()
    );
    const lido = registry.get("lido");
    const aave = registry.get("aave");

    await expect(lido?.fetchRecent()).resolves.toMatchObject([
      {
        protocol: "lido",
        sourceType: "forum",
        sourceId: "1001",
        publisherName: "Allowed Publisher"
      },
      {
        protocol: "lido",
        sourceType: "forum",
        sourceId: "1002",
        publisherName: "Random Person"
      }
    ]);
    const aaveItems = await aave?.fetchRecent();

    expect(aaveItems).toHaveLength(4);
    expect(aaveItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocol: "aave",
          sourceType: "forum",
          sourceId: "25170",
          publisherName: "AaveLabs"
        }),
        expect.objectContaining({
          protocol: "aave",
          sourceType: "forum",
          sourceId: "25168",
          publisherName: "LlamaRisk"
        }),
        expect.objectContaining({
          protocol: "aave",
          sourceType: "forum",
          sourceId: "25154",
          publisherName: "TokenLogic"
        }),
        expect.objectContaining({
          protocol: "aave",
          sourceType: "forum",
          sourceId: "25089",
          publisherName: "Gepetto"
        })
      ])
    );
  });
});

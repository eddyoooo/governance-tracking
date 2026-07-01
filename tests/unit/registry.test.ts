import { describe, expect, it } from "@jest/globals";
import { createProtocolRegistry, ProtocolRegistry } from "../../src/protocols/registry.js";
import { createFakeProtocolAdapter, createSilentLogger, testEnv } from "../helpers/builders.js";

const aaveAllowedPublishers = [
  "LlamaRisk",
  "TokenLogic",
  "Certora",
  "kpk",
  "karpatkey_TokenLogic",
  "AaveLabs",
  "stani"
];
const uniswapAllowedPublishers = [
  "haydenadams",
  "eek637",
  "devinwalsh",
  "kenneth",
  "nataliara",
  "GFXlabs",
  "UniswapFoundation"
];

describe("ProtocolRegistry", () => {
  it("registers, retrieves, and lists protocol adapters", () => {
    const registry = new ProtocolRegistry();
    const lido = createFakeProtocolAdapter({ protocol: "lido" });
    const aave = createFakeProtocolAdapter({ protocol: "aave" });
    const uniswap = createFakeProtocolAdapter({ protocol: "uniswap" });

    registry.register(lido);
    registry.register(aave);
    registry.register(uniswap);

    expect(registry.get("lido")).toBe(lido);
    expect(registry.get("aave")).toBe(aave);
    expect(registry.get("uniswap")).toBe(uniswap);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.list()).toEqual([lido, aave, uniswap]);
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
        AAVE_ALLOWED_PUBLISHERS: JSON.stringify(aaveAllowedPublishers),
        UNISWAP_ENABLED: "false",
        UNISWAP_FORUM_BASE_URL: "https://gov.uniswap.org",
        UNISWAP_FORUM_API_BASE_URL: "https://gov.uniswap.org",
        UNISWAP_ALLOWED_PUBLISHERS: JSON.stringify(uniswapAllowedPublishers)
      }),
      createSilentLogger()
    );

    const lido = registry.get("lido");
    const aave = registry.get("aave");
    const uniswap = registry.get("uniswap");

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
      publisherAllowlist: aaveAllowedPublishers,
      source: {
        protocol: "aave",
        type: "forum",
        name: "Aave Governance Forum",
        baseUrl: "https://governance.aave.com"
      }
    });
    expect(uniswap).toBeDefined();
    expect(uniswap).toMatchObject({
      protocol: "uniswap",
      enabled: false,
      publisherAllowlist: uniswapAllowedPublishers,
      source: {
        protocol: "uniswap",
        type: "forum",
        name: "Uniswap Governance Forum",
        baseUrl: "https://gov.uniswap.org"
      }
    });
  });

  it("uses fixture-backed protocol fetching in demo or memory mode", async () => {
    const registry = createProtocolRegistry(
      testEnv({
        STORAGE_MODE: "memory",
        DEMO_MODE: "true",
        LIDO_ALLOWED_PUBLISHERS: JSON.stringify(["Allowed Publisher"]),
        AAVE_ALLOWED_PUBLISHERS: JSON.stringify(aaveAllowedPublishers),
        UNISWAP_ALLOWED_PUBLISHERS: JSON.stringify(uniswapAllowedPublishers)
      }),
      createSilentLogger()
    );
    const lido = registry.get("lido");
    const aave = registry.get("aave");
    const uniswap = registry.get("uniswap");

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

    expect(aaveItems).toHaveLength(6);
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
          sourceId: "24713",
          publisherName: "Certora"
        }),
        expect.objectContaining({
          protocol: "aave",
          sourceType: "forum",
          sourceId: "20206",
          publisherName: "kpk"
        }),
        expect.objectContaining({
          protocol: "aave",
          sourceType: "forum",
          sourceId: "25089",
          publisherName: "Gepetto"
        })
      ])
    );
    const uniswapItems = await uniswap?.fetchRecent();

    expect(uniswapItems).toHaveLength(8);
    expect(uniswapItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocol: "uniswap",
          sourceType: "forum",
          sourceId: "26035",
          publisherName: "Hayden Adams"
        }),
        expect.objectContaining({
          protocol: "uniswap",
          sourceType: "forum",
          sourceId: "26127",
          publisherName: "eek637"
        }),
        expect.objectContaining({
          protocol: "uniswap",
          sourceType: "forum",
          sourceId: "25250",
          publisherName: "Devin"
        }),
        expect.objectContaining({
          protocol: "uniswap",
          sourceType: "forum",
          sourceId: "20242",
          publisherName: "Ken Ng"
        }),
        expect.objectContaining({
          protocol: "uniswap",
          sourceType: "forum",
          sourceId: "26068",
          publisherName: "Natalia"
        }),
        expect.objectContaining({
          protocol: "uniswap",
          sourceType: "forum",
          sourceId: "26150",
          publisherName: "GFX Labs"
        }),
        expect.objectContaining({
          protocol: "uniswap",
          sourceType: "forum",
          sourceId: "25770",
          publisherName: "UniswapFoundation"
        }),
        expect.objectContaining({
          protocol: "uniswap",
          sourceType: "forum",
          sourceId: "26132",
          publisherName: "Sergei"
        })
      ])
    );
  });
});

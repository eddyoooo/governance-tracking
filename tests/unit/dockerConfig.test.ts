import { readFile } from "node:fs/promises";
import { describe, expect, it } from "@jest/globals";

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("Docker configuration", () => {
  it("keeps the demo compose file credential-free and monitor-only", async () => {
    const compose = await readProjectFile("docker-compose.demo.yml");

    expect(compose).toContain("STORAGE_MODE: memory");
    expect(compose).toContain('DEMO_MODE: "true"');
    expect(compose).toContain('ENABLE_SCHEDULER: "false"');
    expect(compose).toContain('ENABLE_TELEGRAM_NOTIFICATIONS: "false"');
    expect(compose).toContain('AAVE_ALLOWED_PUBLISHERS: \'["LlamaRisk","TokenLogic","Certora","kpk","karpatkey_TokenLogic","AaveLabs","stani"]\'');
    expect(compose).toContain('UNISWAP_ALLOWED_PUBLISHERS: \'["haydenadams","eek637","devinwalsh","kenneth","nataliara","GFXlabs","UniswapFoundation"]\'');
    expect(compose).toContain("UNISWAP_FETCH_MAX_PAGES: 10");
    expect(compose).toContain("UNISWAP_CATEGORY_FETCH_MAX_PAGES: 2");
    expect(compose).not.toContain("FIREBASE_PROJECT_ID");
    expect(compose).not.toContain("FIREBASE_CLIENT_EMAIL");
    expect(compose).not.toContain("FIREBASE_PRIVATE_KEY");
    expect(compose).not.toContain("ENABLE_DEBUG_ENDPOINTS");
    expect(compose).not.toContain("CORS_ORIGIN");
    expect(compose).not.toContain("demo:api");
  });

  it("keeps the production Docker image on compiled output without baked secrets", async () => {
    const dockerfile = await readProjectFile("Dockerfile");
    const dockerignore = await readProjectFile(".dockerignore");

    expect(dockerfile).toContain("RUN npm run build");
    expect(dockerfile).toContain('CMD ["node", "dist/index.js"]');
    expect(dockerfile).not.toContain("COPY .env");
    expect(dockerignore).toContain(".env");
    expect(dockerignore).toContain(".env.*");
    expect(dockerignore).toContain("node_modules");
  });
});

import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "@jest/globals";

function projectFileUrl(path: string): URL {
  return new URL(`../../${path}`, import.meta.url);
}

async function readProjectFile(path: string): Promise<string> {
  return readFile(projectFileUrl(path), "utf8");
}

async function projectFileExists(path: string): Promise<boolean> {
  try {
    await access(projectFileUrl(path));
    return true;
  } catch {
    return false;
  }
}

describe("Docker configuration", () => {
  it("does not keep Docker Compose configuration in the production-only Docker flow", async () => {
    await expect(projectFileExists("docker-compose.yml")).resolves.toBe(false);
    await expect(projectFileExists("docker-compose.demo.yml")).resolves.toBe(false);
  });

  it("keeps the production Docker image on compiled output without baked secrets", async () => {
    const dockerfile = await readProjectFile("Dockerfile");
    const dockerignore = await readProjectFile(".dockerignore");

    expect(dockerfile).toContain("RUN npm run build");
    expect(dockerfile).toContain('CMD ["node", "dist/index.js"]');
    expect(dockerfile).not.toContain("AS dev");
    expect(dockerfile).not.toContain('CMD ["npm", "run", "dev"]');
    expect(dockerfile).not.toContain("COPY .env");
    expect(dockerignore).toContain(".env");
    expect(dockerignore).toContain(".env.*");
    expect(dockerignore).toContain("node_modules");
    expect(dockerignore).toContain("tests");
    expect(dockerignore).toContain("PLATFORM_MANUAL.md");
    expect(dockerignore).toContain(".codex");
    expect(dockerignore).toContain(".agents");
  });
});

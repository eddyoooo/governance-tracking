import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import type { Env } from "../../config/env.js";

function tokenFromHeader(value: string | undefined): string {
  if (!value) {
    return "";
  }

  if (value.toLowerCase().startsWith("bearer ")) {
    return value.slice("bearer ".length).trim();
  }

  return value.trim();
}

function tokensMatch(providedToken: string, expectedToken: string): boolean {
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);

  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function requireApiAuth(env: Env): RequestHandler {
  return (request, response, next) => {
    if (!env.apiAuthEnabled) {
      next();
      return;
    }

    if (!env.apiAuthToken) {
      response.status(500).json({ error: "API auth is enabled but API_AUTH_TOKEN is not set." });
      return;
    }

    const providedToken =
      tokenFromHeader(request.header("authorization")) || request.header("x-api-token") || "";

    if (!providedToken) {
      response.status(401).json({ error: "Missing API auth token." });
      return;
    }

    if (!tokensMatch(providedToken, env.apiAuthToken)) {
      response.status(403).json({ error: "Invalid API auth token." });
      return;
    }

    next();
  };
}

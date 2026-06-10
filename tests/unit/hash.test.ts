import { describe, expect, it } from "@jest/globals";
import {
  createFetchRunId,
  createProposalId,
  hashObject,
  sha256
} from "../../src/utils/hash.js";

describe("hash utilities", () => {
  it("hashes strings with sha256", () => {
    expect(sha256("governance-tracking")).toHaveLength(64);
    expect(sha256("governance-tracking")).toBe(sha256("governance-tracking"));
    expect(sha256("governance-tracking")).not.toBe(sha256("governance-tracking!"));
  });

  it("generates deterministic proposal ids", () => {
    expect(createProposalId("lido", "forum", "1001")).toBe(
      createProposalId("lido", "forum", "1001")
    );
    expect(createProposalId("lido", "forum", "1001")).not.toBe(
      createProposalId("lido", "forum", "1002")
    );
  });

  it("sanitizes unsafe source ids but keeps deterministic uniqueness", () => {
    const id = createProposalId("lido", "forum", "topic/1001?draft=true");

    expect(id).toMatch(/^lido_forum_topic_1001_draft_true_[a-f0-9]{10}$/);
    expect(id).toBe(createProposalId("lido", "forum", "topic/1001?draft=true"));
  });

  it("hashes objects deterministically regardless of key order", () => {
    expect(hashObject({ b: 2, a: 1 })).toBe(hashObject({ a: 1, b: 2 }));
  });

  it("hashes nested arrays and objects deterministically", () => {
    expect(hashObject({ b: [{ z: 1, a: 2 }], a: null })).toBe(
      hashObject({ a: null, b: [{ a: 2, z: 1 }] })
    );
  });

  it("hashes undefined values deterministically", () => {
    expect(hashObject(undefined)).toBe(hashObject(undefined));
    expect(hashObject({ value: undefined })).toBe(hashObject({ value: undefined }));
    expect(hashObject(undefined)).not.toBe(hashObject(null));
  });

  it("generates deterministic fetch run ids from protocol and start time", () => {
    const id = createFetchRunId("lido", "2026-06-05T00:00:00.000Z");

    expect(id).toMatch(/^fetchRun_lido_[a-f0-9]{12}$/);
    expect(id).toBe(createFetchRunId("lido", "2026-06-05T00:00:00.000Z"));
    expect(id).not.toBe(createFetchRunId("lido", "2026-06-05T06:00:00.000Z"));
  });
});

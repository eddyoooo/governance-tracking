import { describe, expect, it } from "@jest/globals";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import {
  buildStoredProposal,
  hasMeaningfulProposalChange,
  proposalIdFromSourceIdentity,
  proposalSortDirection,
  proposalSortFields,
  proposalSortValues
} from "../../src/storage/proposal.repositoryUtils.js";
import { createProposalId } from "../../src/utils/hash.js";
import { createRawGovernanceItem } from "../helpers/builders.js";

describe("proposal repository utilities", () => {
  it("keeps accepted sort values aligned with repository sort fields", () => {
    expect(new Set(proposalSortValues).size).toBe(proposalSortValues.length);
    expect(proposalSortValues).toEqual(Object.keys(proposalSortFields));
    expect(proposalSortValues).toEqual([
      "publishedAt_desc",
      "publishedAt_asc",
      "firstSeenAt_desc",
      "firstSeenAt_asc",
      "lastSeenAt_desc",
      "lastSeenAt_asc"
    ]);
  });

  it("derives sort direction only from the sort suffix", () => {
    expect(proposalSortDirection("publishedAt_asc")).toBe("asc");
    expect(proposalSortDirection("publishedAt_desc")).toBe("desc");
    expect(proposalSortDirection("firstSeenAt_asc")).toBe("asc");
    expect(proposalSortDirection("lastSeenAt_desc")).toBe("desc");
  });

  it("creates deterministic source identity ids using the shared hash utility", () => {
    expect(proposalIdFromSourceIdentity("lido", "forum", "topic/1001")).toBe(
      createProposalId("lido", "forum", "topic/1001")
    );
    expect(proposalIdFromSourceIdentity("lido", "forum", "topic/1001")).toMatch(
      /^lido_forum_topic_1001_[a-f0-9]{10}$/
    );
  });

  it("ignores fetch timestamp churn when checking for meaningful proposal changes", () => {
    const existing = buildStoredProposal(
      normalizeLidoForumItem(
        createRawGovernanceItem({
          fetchedAt: "2026-06-05T00:00:00.000Z"
        })
      ),
      null,
      {},
      "2026-06-05T00:00:00.000Z"
    );
    const laterFetch = normalizeLidoForumItem(
      createRawGovernanceItem({
        fetchedAt: "2026-06-05T06:00:00.000Z"
      })
    );

    expect(hasMeaningfulProposalChange(existing, laterFetch)).toBe(false);
  });

  it.each([
    ["protocol", { protocol: "aave" }],
    ["sourceType", { sourceType: "snapshot" }],
    ["sourceId", { sourceId: "1002" }],
    ["title", { title: "Changed title" }],
    ["publisherName", { publisherName: "Changed Publisher" }],
    ["sourceUrl", { sourceUrl: "https://research.lido.fi/t/changed/1001" }],
    ["publishedAt", { publishedAt: "2026-05-02T10:00:00.000Z" }]
  ])("detects meaningful source changes in %s", (_field, overrides) => {
    const existing = buildStoredProposal(
      normalizeLidoForumItem(createRawGovernanceItem()),
      null,
      {},
      "2026-06-05T00:00:00.000Z"
    );
    const changed = normalizeLidoForumItem(createRawGovernanceItem(overrides));

    expect(hasMeaningfulProposalChange(existing, changed)).toBe(true);
  });

  it("detects a rawHash change if normalized source hashing changes", () => {
    const existing = buildStoredProposal(
      normalizeLidoForumItem(createRawGovernanceItem()),
      null,
      {},
      "2026-06-05T00:00:00.000Z"
    );
    const changed = {
      ...normalizeLidoForumItem(createRawGovernanceItem()),
      rawHash: "b".repeat(64)
    };

    expect(hasMeaningfulProposalChange(existing, changed)).toBe(true);
  });

  it("builds new stored proposals with lifecycle and notification defaults", () => {
    const normalized = normalizeLidoForumItem(createRawGovernanceItem());

    expect(
      buildStoredProposal(
        normalized,
        null,
        { notificationStatusForNew: "pending" },
        "2026-06-05T00:00:00.000Z"
      )
    ).toMatchObject({
      id: normalized.id,
      firstSeenAt: "2026-06-05T00:00:00.000Z",
      lastSeenAt: "2026-06-05T00:00:00.000Z",
      notificationStatus: "pending",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z"
    });
  });

  it("preserves existing identity, first-seen metadata, and notification state on updates", () => {
    const initial = buildStoredProposal(
      normalizeLidoForumItem(createRawGovernanceItem()),
      null,
      { notificationStatusForNew: "pending" },
      "2026-06-05T00:00:00.000Z"
    );
    const failedExisting = {
      ...initial,
      notificationStatus: "failed" as const,
      notificationError: "Telegram failed"
    };
    const changed = {
      ...normalizeLidoForumItem(
        createRawGovernanceItem({
          title: "Updated title"
        })
      ),
      id: "ignored_incoming_id"
    };

    expect(
      buildStoredProposal(
        changed,
        failedExisting,
        { notificationStatusForNew: "pending" },
        "2026-06-05T06:00:00.000Z"
      )
    ).toMatchObject({
      id: initial.id,
      title: "Updated title",
      firstSeenAt: "2026-06-05T00:00:00.000Z",
      lastSeenAt: "2026-06-05T06:00:00.000Z",
      notificationStatus: "failed",
      notificationError: "Telegram failed",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T06:00:00.000Z"
    });
  });
});

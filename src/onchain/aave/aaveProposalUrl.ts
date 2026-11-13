export function aaveProposalUrl(proposalId: string): string {
  return `https://app.aave.com/governance/v3/proposal/?proposalId=${proposalId}`;
}

export function migrateAaveProposalUrl(sourceUrl: string, expectedProposalId?: string): string {
  const legacy = /^https:\/\/vote\.onaave\.com\/proposal\/\?proposalId=(0|[1-9]\d*)$/.exec(sourceUrl);
  if (!legacy || legacy[0] !== sourceUrl ||
      (expectedProposalId !== undefined && legacy[1] !== expectedProposalId)) {
    return sourceUrl;
  }

  return aaveProposalUrl(legacy[1]);
}

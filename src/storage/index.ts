import type { Logger } from "pino";
import type { Env } from "../config/env.js";
import { isMemoryMode } from "../config/env.js";
import { getFirestoreDb } from "../config/firebase.js";
import {
  FirestoreFetchRunRepository,
  MemoryFetchRunRepository,
  type FetchRunRepository
} from "./fetchRun.repository.js";
import { FirestoreProposalRepository } from "./firestoreProposal.repository.js";
import { MemoryProposalRepository } from "./memoryProposal.repository.js";
import type { ProposalRepository } from "./proposal.repository.js";
import {
  FirestoreSourceActivityRepository,
  MemorySourceActivityRepository,
  type SourceActivityRepository
} from "./sourceActivity.repository.js";

export interface Repositories {
  proposalRepository: ProposalRepository;
  fetchRunRepository: FetchRunRepository;
  sourceActivityRepository: SourceActivityRepository;
}

export function createRepositories(env: Env, logger: Logger): Repositories {
  if (isMemoryMode(env)) {
    logger.info("Using in-memory repositories");

    return {
      proposalRepository: new MemoryProposalRepository(),
      fetchRunRepository: new MemoryFetchRunRepository(),
      sourceActivityRepository: new MemorySourceActivityRepository()
    };
  }

  logger.info("Using Firestore repositories");
  const db = getFirestoreDb(env);

  return {
    proposalRepository: new FirestoreProposalRepository(db),
    fetchRunRepository: new FirestoreFetchRunRepository(db),
    sourceActivityRepository: new FirestoreSourceActivityRepository(db)
  };
}

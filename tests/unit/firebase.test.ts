import { generateKeyPairSync } from "node:crypto";
import { deleteApp, getApps } from "firebase-admin/app";
import { afterEach, describe, expect, it } from "@jest/globals";
import {
  assertFirebaseConfigured,
  getFirebaseApp,
  getFirestoreDb
} from "../../src/config/firebase.js";
import { FirestoreFetchRunRepository } from "../../src/storage/fetchRun.repository.js";
import { FirestoreProposalRepository } from "../../src/storage/firestoreProposal.repository.js";
import { createRepositories } from "../../src/storage/index.js";
import { FirestoreProtocolStateRepository } from "../../src/storage/protocolState.repository.js";
import { FirestoreSourceActivityRepository } from "../../src/storage/sourceActivity.repository.js";
import { createSilentLogger, testEnv } from "../helpers/builders.js";

describe("Firebase configuration", () => {
  afterEach(async () => {
    await Promise.all(getApps().map((app) => deleteApp(app)));
  });

  it("throws a clear error listing missing Firebase fields", () => {
    expect(() =>
      assertFirebaseConfigured(
        testEnv({
          STORAGE_MODE: "firestore",
          DEMO_MODE: "false",
          FIREBASE_PROJECT_ID: "",
          FIREBASE_CLIENT_EMAIL: "",
          FIREBASE_PRIVATE_KEY: ""
        })
      )
    ).toThrow(
      "Firebase is required in firestore mode. Missing: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
    );
  });

  it("lists only the Firebase fields that are still missing", () => {
    expect(() =>
      assertFirebaseConfigured(
        testEnv({
          STORAGE_MODE: "firestore",
          DEMO_MODE: "false",
          FIREBASE_PROJECT_ID: "project",
          FIREBASE_CLIENT_EMAIL: "",
          FIREBASE_PRIVATE_KEY: ""
        })
      )
    ).toThrow(
      "Firebase is required in firestore mode. Missing: FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
    );
  });

  it("passes when all required Firestore credentials are present", () => {
    expect(() =>
      assertFirebaseConfigured(
        testEnv({
          STORAGE_MODE: "firestore",
          DEMO_MODE: "false",
          FIREBASE_PROJECT_ID: "project",
          FIREBASE_CLIENT_EMAIL: "service@example.com",
          FIREBASE_PRIVATE_KEY: "private-key"
        })
      )
    ).not.toThrow();
  });

  it("initializes one reusable Firebase app and constructs Firestore without network access", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048
    });
    const env = testEnv({
      STORAGE_MODE: "firestore",
      DEMO_MODE: "false",
      FIREBASE_PROJECT_ID: "unit-test-project",
      FIREBASE_CLIENT_EMAIL: "unit-test@unit-test-project.iam.gserviceaccount.com",
      FIREBASE_PRIVATE_KEY: privateKey.export({
        type: "pkcs8",
        format: "pem"
      }) as string
    });

    const first = getFirebaseApp(env);
    const second = getFirebaseApp(env);
    const firestore = getFirestoreDb(env);
    const repeatedFirestore = getFirestoreDb(env);
    const repositories = createRepositories(env, createSilentLogger());

    expect(first).toBe(second);
    expect(getApps()).toHaveLength(1);
    expect(firestore).toBe(repeatedFirestore);
    expect(repositories.proposalRepository).toBeInstanceOf(
      FirestoreProposalRepository
    );
    expect(repositories.fetchRunRepository).toBeInstanceOf(
      FirestoreFetchRunRepository
    );
    expect(repositories.sourceActivityRepository).toBeInstanceOf(
      FirestoreSourceActivityRepository
    );
    expect(repositories.protocolStateRepository).toBeInstanceOf(
      FirestoreProtocolStateRepository
    );
  });
});

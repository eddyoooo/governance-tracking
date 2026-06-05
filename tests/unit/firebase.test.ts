import { describe, expect, it } from "@jest/globals";
import { assertFirebaseConfigured } from "../../src/config/firebase.js";
import { testEnv } from "../helpers/builders.js";

describe("Firebase configuration", () => {
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
});

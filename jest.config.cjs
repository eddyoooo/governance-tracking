module.exports = {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  testMatch: ["**/tests/**/*.test.ts"],
  collectCoverage: true,
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/index.ts",
    "!src/demo.ts",
    "!src/telegramTestSend.ts"
  ],
  coverageReporters: ["text-summary"],
  coverageThreshold: {
    global: {
      statements: 97,
      branches: 88,
      functions: 96,
      lines: 97
    },
    "./src/jobs/fetchProtocolGovernance.job.ts": {
      statements: 100,
      branches: 93,
      functions: 100,
      lines: 100
    },
    "./src/scheduler/scheduler.ts": {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100
    },
    "./src/sourceActivity/sourceActivity.service.ts": {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100
    },
    "./src/notifications/proposalNotifications.ts": {
      statements: 96,
      branches: 89,
      functions: 97,
      lines: 96
    },
    "./src/notifications/telegramNotification.service.ts": {
      statements: 97,
      branches: 89,
      functions: 96,
      lines: 98
    },
    "./src/adminStatus/adminStatus.service.ts": {
      statements: 97,
      branches: 84,
      functions: 96,
      lines: 98
    },
    "./src/storage/firestoreProposal.repository.ts": {
      statements: 100,
      branches: 81,
      functions: 100,
      lines: 100
    }
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          esModuleInterop: true,
          strict: true,
          isolatedModules: true,
          resolveJsonModule: true,
          types: ["node", "jest"]
        }
      }
    ]
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1"
  }
};

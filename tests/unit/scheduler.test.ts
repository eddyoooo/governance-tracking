import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createSilentLogger, testEnv } from "../helpers/builders.js";

const validateMock = jest.fn();
const scheduleMock = jest.fn();

jest.unstable_mockModule("node-cron", () => ({
  default: {
    validate: validateMock,
    schedule: scheduleMock
  },
  validate: validateMock,
  schedule: scheduleMock
}));

const { startScheduler } = await import("../../src/scheduler/scheduler.js");

function createContext(overrides: NodeJS.ProcessEnv = {}) {
  return {
    env: testEnv({
      ENABLE_SCHEDULER: "true",
      FETCH_INTERVAL_CRON: "0 8 * * *",
      ...overrides
    }),
    logger: createSilentLogger(),
    fetchJob: {
      run: jest.fn(async () => undefined)
    },
    adminStatusReporter: {
      enabled: false,
      sendDailyStatusReport: jest.fn(async () => ({
        healthy: true,
        message: "",
        problems: []
      }))
    },
    notificationService: {
      name: "test-notifications",
      enabled: false,
      getRecipients: jest.fn(() => []),
      send: jest.fn(async () => undefined)
    },
    notificationDispatcher: {
      recoverOutstanding: jest.fn(async () => ({
        candidateCount: 0,
        attemptedProposalCount: 0,
        attemptedRecipientCount: 0,
        recoveredCount: 0,
        stillPendingCount: 0,
        stillFailedCount: 0,
        skippedCount: 0,
        errors: [],
        skippedBecauseRunning: false
      }))
    },
    proposalRepository: {},
    fetchRunRepository: {},
    protocolRegistry: {
      list: jest.fn(() => [
        {
          protocol: "lido",
          enabled: true
        },
        {
          protocol: "aave",
          enabled: true
        },
        {
          protocol: "uniswap",
          enabled: true
        }
      ])
    }
  };
}

describe("scheduler", () => {
  beforeEach(() => {
    validateMock.mockReset();
    scheduleMock.mockReset();
  });

  it("does not start when scheduler is disabled", () => {
    const context = createContext({
      ENABLE_SCHEDULER: "false"
    });

    expect(startScheduler(context as never)).toBeNull();
    expect(validateMock).not.toHaveBeenCalled();
    expect(scheduleMock).not.toHaveBeenCalled();
    expect(context.logger.info).toHaveBeenCalledWith("Scheduler disabled");
  });

  it("throws before scheduling when the cron expression is invalid", () => {
    const context = createContext({
      FETCH_INTERVAL_CRON: "not-a-cron"
    });
    validateMock.mockReturnValue(false);

    expect(() => startScheduler(context as never)).toThrow(
      "Invalid FETCH_INTERVAL_CRON: not-a-cron"
    );
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("schedules enabled protocol fetch jobs with the configured cron", () => {
    const task = { stop: jest.fn() };
    const context = createContext();
    validateMock.mockReturnValue(true);
    scheduleMock.mockReturnValue(task);

    const handle = startScheduler(context as never);

    expect(handle).not.toBeNull();
    expect(validateMock).toHaveBeenCalledWith("0 8 * * *");
    expect(scheduleMock).toHaveBeenCalledWith("0 8 * * *", expect.any(Function));
    expect(context.logger.info).toHaveBeenCalledWith(
      { cron: "0 8 * * *", protocols: ["lido", "aave", "uniswap"] },
      "Starting governance fetch scheduler"
    );
    handle?.stop();
    expect(task.stop).toHaveBeenCalledTimes(1);
  });

  it("does not start when no protocol adapters are enabled", () => {
    const context = createContext();
    context.protocolRegistry.list.mockReturnValueOnce([
      {
        protocol: "lido",
        enabled: false
      },
      {
        protocol: "aave",
        enabled: false
      },
      {
        protocol: "uniswap",
        enabled: false
      }
    ]);
    validateMock.mockReturnValue(true);

    expect(startScheduler(context as never)).toBeNull();
    expect(scheduleMock).not.toHaveBeenCalled();
    expect(context.logger.warn).toHaveBeenCalledWith(
      "No enabled protocol adapters found for governance fetch scheduler"
    );
    expect(context.logger.warn).toHaveBeenCalledWith(
      "Scheduler not started because no scheduled jobs are enabled"
    );
  });

  it("throws before scheduling when the admin status cron expression is invalid", () => {
    const context = createContext({
      ADMIN_STATUS_CRON: "not-a-cron",
      ENABLE_ADMIN_STATUS_REPORTS: "true",
      TELEGRAM_BOT_TOKEN: "token"
    });

    context.adminStatusReporter.enabled = true;
    validateMock.mockImplementation((cron: string) => cron !== "not-a-cron");

    expect(() => startScheduler(context as never)).toThrow(
      "Invalid ADMIN_STATUS_CRON: not-a-cron"
    );
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("throws before scheduling when the notification retry cron is invalid", () => {
    const context = createContext({
      NOTIFICATION_RETRY_CRON: "not-a-cron"
    });
    context.notificationService.enabled = true;
    validateMock.mockImplementation((cron: string) => cron !== "not-a-cron");

    expect(() => startScheduler(context as never)).toThrow(
      "Invalid NOTIFICATION_RETRY_CRON: not-a-cron"
    );
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("schedules and executes automatic notification recovery when Telegram is enabled", async () => {
    let recoveryCallback: (() => void) | undefined;
    const context = createContext({
      NOTIFICATION_RETRY_CRON: "*/15 * * * *"
    });
    context.notificationService.enabled = true;
    context.notificationDispatcher.recoverOutstanding.mockResolvedValueOnce({
      candidateCount: 2,
      attemptedProposalCount: 1,
      attemptedRecipientCount: 1,
      recoveredCount: 1,
      stillPendingCount: 0,
      stillFailedCount: 1,
      skippedCount: 0,
      errors: [],
      skippedBecauseRunning: false
    });
    validateMock.mockReturnValue(true);
    scheduleMock.mockImplementation((cron: string, callback: () => void) => {
      if (cron === "*/15 * * * *") {
        recoveryCallback = callback;
      }

      return { stop: jest.fn() };
    });

    startScheduler(context as never);

    expect(validateMock).toHaveBeenCalledWith("*/15 * * * *");
    expect(scheduleMock).toHaveBeenCalledWith(
      "*/15 * * * *",
      expect.any(Function)
    );
    expect(context.logger.info).toHaveBeenCalledWith(
      { cron: "*/15 * * * *" },
      "Starting automatic notification recovery scheduler"
    );

    recoveryCallback?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      context.notificationDispatcher.recoverOutstanding
    ).toHaveBeenCalledTimes(1);
    expect(context.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateCount: 2,
        attemptedRecipientCount: 1,
        recoveredCount: 1,
        stillFailedCount: 1
      }),
      "Finished automatic notification recovery"
    );
  });

  it("keeps an empty notification recovery cycle quiet", async () => {
    let recoveryCallback: (() => void) | undefined;
    const context = createContext();
    context.notificationService.enabled = true;
    validateMock.mockReturnValue(true);
    scheduleMock.mockImplementation((cron: string, callback: () => void) => {
      if (cron === context.env.notificationRetryCron) {
        recoveryCallback = callback;
      }

      return { stop: jest.fn() };
    });

    startScheduler(context as never);
    recoveryCallback?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      context.notificationDispatcher.recoverOutstanding
    ).toHaveBeenCalledTimes(1);
    expect(context.logger.info).not.toHaveBeenCalledWith(
      expect.any(Object),
      "Finished automatic notification recovery"
    );
  });

  it("logs automatic notification recovery failures without stopping other schedules", async () => {
    let recoveryCallback: (() => void) | undefined;
    const context = createContext();
    const error = new Error("Firestore recovery read failed");
    context.notificationService.enabled = true;
    context.notificationDispatcher.recoverOutstanding.mockRejectedValueOnce(
      error as never
    );
    validateMock.mockReturnValue(true);
    scheduleMock.mockImplementation((cron: string, callback: () => void) => {
      if (cron === context.env.notificationRetryCron) {
        recoveryCallback = callback;
      }

      return { stop: jest.fn() };
    });

    startScheduler(context as never);
    recoveryCallback?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(context.logger.error).toHaveBeenCalledWith(
      { error },
      "Scheduled notification recovery failed"
    );
  });

  it("schedules daily admin status reports when enabled", async () => {
    let adminCallback: (() => void) | undefined;
    const context = createContext({
      ADMIN_STATUS_CRON: "0 9 * * *",
      ENABLE_ADMIN_STATUS_REPORTS: "true",
      TELEGRAM_BOT_TOKEN: "token"
    });
    const fetchTask = { stop: jest.fn() };
    const adminTask = { stop: jest.fn() };

    context.adminStatusReporter.enabled = true;
    validateMock.mockReturnValue(true);
    scheduleMock.mockImplementation((cron: string, callback: () => void) => {
      if (cron === "0 9 * * *") {
        adminCallback = callback;
        return adminTask;
      }

      return fetchTask;
    });

    const handle = startScheduler(context as never);

    expect(scheduleMock).toHaveBeenCalledWith("0 8 * * *", expect.any(Function));
    expect(scheduleMock).toHaveBeenCalledWith("0 9 * * *", expect.any(Function));
    expect(context.logger.info).toHaveBeenCalledWith(
      { cron: "0 9 * * *" },
      "Starting admin status report scheduler"
    );

    adminCallback?.();
    await Promise.resolve();

    expect(context.adminStatusReporter.sendDailyStatusReport).toHaveBeenCalledTimes(1);
    handle?.stop();
    expect(fetchTask.stop).toHaveBeenCalledTimes(1);
    expect(adminTask.stop).toHaveBeenCalledTimes(1);
  });

  it("logs scheduled admin status failures without throwing from the callback", async () => {
    let adminCallback: (() => void) | undefined;
    const context = createContext({
      ADMIN_STATUS_CRON: "0 9 * * *",
      ENABLE_ADMIN_STATUS_REPORTS: "true",
      TELEGRAM_BOT_TOKEN: "token"
    });
    const error = new Error("admin status failed");

    context.adminStatusReporter.enabled = true;
    context.adminStatusReporter.sendDailyStatusReport.mockRejectedValueOnce(
      error as never
    );
    validateMock.mockReturnValue(true);
    scheduleMock.mockImplementation((cron: string, callback: () => void) => {
      if (cron === "0 9 * * *") {
        adminCallback = callback;
      }

      return { stop: jest.fn() };
    });

    startScheduler(context as never);
    adminCallback?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(context.logger.error).toHaveBeenCalledWith(
      { error },
      "Scheduled admin status report failed"
    );
  });

  it("runs every enabled protocol fetch job when the scheduled callback fires", async () => {
    let scheduledCallback: (() => void) | undefined;
    const context = createContext();
    validateMock.mockReturnValue(true);
    scheduleMock.mockImplementation((_cron: string, callback: () => void) => {
      scheduledCallback = callback;
      return { stop: jest.fn() };
    });

    startScheduler(context as never);
    scheduledCallback?.();
    await Promise.resolve();

    expect(context.fetchJob.run).toHaveBeenCalledWith("lido");
    expect(context.fetchJob.run).toHaveBeenCalledWith("aave");
    expect(context.fetchJob.run).toHaveBeenCalledWith("uniswap");
    expect(context.fetchJob.run).toHaveBeenCalledTimes(3);
  });

  it("does not run disabled protocol adapters from the scheduler", async () => {
    let scheduledCallback: (() => void) | undefined;
    const context = createContext();
    context.protocolRegistry.list.mockReturnValueOnce([
      {
        protocol: "lido",
        enabled: true
      },
      {
        protocol: "aave",
        enabled: false
      },
      {
        protocol: "uniswap",
        enabled: true
      }
    ]);
    validateMock.mockReturnValue(true);
    scheduleMock.mockImplementation((_cron: string, callback: () => void) => {
      scheduledCallback = callback;
      return { stop: jest.fn() };
    });

    startScheduler(context as never);
    scheduledCallback?.();
    await Promise.resolve();

    expect(context.fetchJob.run).toHaveBeenCalledWith("lido");
    expect(context.fetchJob.run).not.toHaveBeenCalledWith("aave");
    expect(context.fetchJob.run).toHaveBeenCalledWith("uniswap");
  });

  it("logs scheduled fetch failures without throwing from the callback", async () => {
    let scheduledCallback: (() => void) | undefined;
    const context = createContext();
    const error = new Error("scheduled failure");
    context.fetchJob.run.mockRejectedValueOnce(error as never);
    validateMock.mockReturnValue(true);
    scheduleMock.mockImplementation((_cron: string, callback: () => void) => {
      scheduledCallback = callback;
      return { stop: jest.fn() };
    });

    startScheduler(context as never);
    scheduledCallback?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(context.logger.error).toHaveBeenCalledWith(
      { error, protocol: "lido" },
      "Scheduled governance fetch failed"
    );
  });
});

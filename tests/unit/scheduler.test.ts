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
      FETCH_INTERVAL_CRON: "0 */6 * * *",
      ...overrides
    }),
    logger: createSilentLogger(),
    fetchJob: {
      run: jest.fn(async () => undefined)
    },
    proposalRepository: {},
    fetchRunRepository: {},
    protocolRegistry: {}
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

  it("schedules the Lido fetch job with the configured six-hour cron", () => {
    const task = { stop: jest.fn() };
    const context = createContext();
    validateMock.mockReturnValue(true);
    scheduleMock.mockReturnValue(task);

    expect(startScheduler(context as never)).toBe(task);
    expect(validateMock).toHaveBeenCalledWith("0 */6 * * *");
    expect(scheduleMock).toHaveBeenCalledWith("0 */6 * * *", expect.any(Function));
    expect(context.logger.info).toHaveBeenCalledWith(
      { cron: "0 */6 * * *" },
      "Starting governance fetch scheduler"
    );
  });

  it("runs the Lido fetch job when the scheduled callback fires", async () => {
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
      { error },
      "Scheduled Lido fetch failed"
    );
  });
});

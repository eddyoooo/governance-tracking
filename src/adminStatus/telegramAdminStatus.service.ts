import type { Logger } from "pino";
import type { AdminStatusNotifier } from "./adminStatus.service.js";

export interface TelegramAdminStatusNotifierOptions {
  botToken: string;
  adminUserId: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Logger, "debug" | "error">;
  requestTimeoutMs?: number;
}

export const DEFAULT_TELEGRAM_ADMIN_STATUS_TIMEOUT_MS = 15_000;

export class TelegramAdminStatusDeliveryError extends Error {
  constructor(readonly status?: number, readonly responseBody?: string) {
    super(
      `Telegram admin status message failed${
        status ? ` with ${status}` : ""
      }${responseBody ? `: ${responseBody}` : "."}`
    );
    this.name = "TelegramAdminStatusDeliveryError";
  }
}

export class TelegramAdminStatusNotifier implements AdminStatusNotifier {
  readonly name = "telegram-admin-status";
  readonly enabled = true;
  private readonly botToken: string;
  private readonly adminUserId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: Pick<Logger, "debug" | "error">;
  private readonly requestTimeoutMs: number;

  constructor(options: TelegramAdminStatusNotifierOptions) {
    const botToken = options.botToken.trim();
    const adminUserId = options.adminUserId.trim();

    if (!botToken) {
      throw new Error("TelegramAdminStatusNotifier requires a bot token.");
    }

    if (!/^[1-9]\d*$/.test(adminUserId)) {
      throw new Error(
        "TelegramAdminStatusNotifier admin user id must be a positive numeric Telegram user ID."
      );
    }

    this.botToken = botToken;
    this.adminUserId = adminUserId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_TELEGRAM_ADMIN_STATUS_TIMEOUT_MS;
  }

  async send(message: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs
    );

    this.logger?.debug(
      { notificationService: this.name },
      "Sending Telegram admin status report"
    );

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          chat_id: this.adminUserId,
          text: message,
          parse_mode: "HTML",
          disable_web_page_preview: true
        })
      });

      if (!response.ok) {
        const responseBody = this.redact(
          await response.text().catch(() => "")
        );

        this.logger?.error(
          {
            notificationService: this.name,
            status: response.status,
            responseBody
          },
          "Telegram admin status report failed"
        );
        throw new TelegramAdminStatusDeliveryError(response.status, responseBody);
      }
    } catch (error) {
      if (error instanceof TelegramAdminStatusDeliveryError) {
        throw error;
      }

      const rawErrorMessage = controller.signal.aborted
        ? `Telegram admin status request timed out after ${this.requestTimeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
      const errorMessage = this.redact(rawErrorMessage);

      this.logger?.error(
        {
          notificationService: this.name,
          errorMessage
        },
        "Telegram admin status report request failed"
      );
      throw new TelegramAdminStatusDeliveryError(undefined, errorMessage);
    } finally {
      clearTimeout(timeout);
    }
  }

  private redact(value: string): string {
    return [this.botToken, this.adminUserId].reduce(
      (redacted, sensitiveValue) =>
        redacted.split(sensitiveValue).join("[redacted]"),
      value
    );
  }
}

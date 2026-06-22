import type { Logger } from "pino";
import type {
  NotificationMessage,
  NotificationService
} from "./notification.service.js";

export interface TelegramNotificationServiceOptions {
  botToken: string;
  allowedUserIds: string[];
  fetchImpl?: typeof fetch;
  logger?: Pick<Logger, "debug" | "error">;
}

interface TelegramRecipientFailure {
  recipientIndex: number;
  status?: number;
  responseBody?: string;
  errorMessage?: string;
}

export class TelegramNotificationDeliveryError extends Error {
  constructor(
    readonly failures: TelegramRecipientFailure[],
    readonly attemptedRecipientCount: number
  ) {
    const detail = failures
      .map((failure) => {
        if (failure.status) {
          return `recipient ${failure.recipientIndex} failed with ${failure.status}${
            failure.responseBody ? `: ${failure.responseBody}` : ""
          }`;
        }

        return `recipient ${failure.recipientIndex} failed${
          failure.errorMessage ? `: ${failure.errorMessage}` : ""
        }`;
      })
      .join("; ");

    super(
      `Telegram notification failed for ${failures.length} of ${attemptedRecipientCount} allowed recipients${
        detail ? `: ${detail}` : "."
      }`
    );
    this.name = "TelegramNotificationDeliveryError";
  }
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function redactTelegramSensitiveValues(
  value: string,
  botToken: string,
  allowedUserIds: string[]
): string {
  return [botToken, ...allowedUserIds].reduce(
    (redacted, sensitiveValue) =>
      redacted.split(sensitiveValue).join("[redacted]"),
    value
  );
}

export function formatTelegramGovernanceMessage(
  message: NotificationMessage
): string {
  return [
    "<b>NEW GOVERNANCE ITEM TRACKED</b>",
    `Protocol: ${escapeTelegramHtml(titleCase(message.protocol))}`,
    `Source: ${escapeTelegramHtml(titleCase(message.sourceType))}`,
    `Publisher: ${escapeTelegramHtml(message.publisherName)}`,
    `Title: ${escapeTelegramHtml(message.title)}`,
    `Link: ${escapeTelegramHtml(message.sourceUrl)}`
  ].join("\n");
}

export class TelegramNotificationService implements NotificationService {
  readonly name = "telegram";
  readonly enabled = true;
  private readonly botToken: string;
  private readonly allowedUserIds: string[];
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: Pick<Logger, "debug" | "error">;

  constructor(options: TelegramNotificationServiceOptions) {
    const botToken = options.botToken.trim();
    const allowedUserIds = [
      ...new Set(options.allowedUserIds.map((id) => id.trim()))
    ].filter(Boolean);

    if (!botToken) {
      throw new Error("TelegramNotificationService requires a bot token.");
    }

    if (allowedUserIds.length === 0) {
      throw new Error("TelegramNotificationService requires at least one allowed user id.");
    }

    if (!allowedUserIds.every((id) => /^[1-9]\d*$/.test(id))) {
      throw new Error(
        "TelegramNotificationService allowed user ids must be positive numeric Telegram user IDs."
      );
    }

    this.botToken = botToken;
    this.allowedUserIds = allowedUserIds;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger;
  }

  async send(message: NotificationMessage): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const text = formatTelegramGovernanceMessage(message);

    this.logger?.debug(
      {
        notificationService: this.name,
        allowedRecipientCount: this.allowedUserIds.length
      },
      "Sending Telegram governance notification"
    );

    const failures: TelegramRecipientFailure[] = [];

    for (const [recipientIndex, recipientUserId] of this.allowedUserIds.entries()) {
      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            chat_id: recipientUserId,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: false
          })
        });

        if (!response.ok) {
          const responseBody = redactTelegramSensitiveValues(
            await response.text().catch(() => ""),
            this.botToken,
            this.allowedUserIds
          );
          const failure = {
            recipientIndex: recipientIndex + 1,
            status: response.status,
            responseBody
          };

          failures.push(failure);
          this.logger?.error(
            {
              notificationService: this.name,
              recipientIndex: recipientIndex + 1,
              status: response.status,
              responseBody
            },
            "Telegram notification failed for allowed recipient"
          );
        }
      } catch (error) {
        const errorMessage = redactTelegramSensitiveValues(
          error instanceof Error ? error.message : String(error),
          this.botToken,
          this.allowedUserIds
        );
        const failure = {
          recipientIndex: recipientIndex + 1,
          errorMessage
        };

        failures.push(failure);
        this.logger?.error(
          {
            notificationService: this.name,
            recipientIndex: recipientIndex + 1,
            error
          },
          "Telegram notification request failed for allowed recipient"
        );
      }
    }

    if (failures.length > 0) {
      throw new TelegramNotificationDeliveryError(failures, this.allowedUserIds.length);
    }
  }
}

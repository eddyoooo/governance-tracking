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
  recipientUserId: string;
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
          return `user ${failure.recipientUserId} failed with ${failure.status}${
            failure.responseBody ? `: ${failure.responseBody}` : ""
          }`;
        }

        return `user ${failure.recipientUserId} failed${
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
    const allowedUserIds = [
      ...new Set(options.allowedUserIds.map((id) => id.trim()))
    ].filter(Boolean);

    if (allowedUserIds.length === 0) {
      throw new Error("TelegramNotificationService requires at least one allowed user id.");
    }

    this.botToken = options.botToken;
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

    for (const recipientUserId of this.allowedUserIds) {
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
          const responseBody = await response.text().catch(() => "");
          const failure = {
            recipientUserId,
            status: response.status,
            responseBody
          };

          failures.push(failure);
          this.logger?.error(
            {
              notificationService: this.name,
              recipientUserId,
              status: response.status,
              responseBody
            },
            "Telegram notification failed for allowed recipient"
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const failure = {
          recipientUserId,
          errorMessage
        };

        failures.push(failure);
        this.logger?.error(
          {
            notificationService: this.name,
            recipientUserId,
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

import type { Logger } from "pino";
import { sha256 } from "../utils/hash.js";
import type {
  NotificationMessage,
  NotificationRecipient,
  NotificationService
} from "./notification.service.js";

export interface TelegramNotificationServiceOptions {
  botToken: string;
  allowedUserIds: string[];
  fetchImpl?: typeof fetch;
  logger?: Pick<Logger, "debug" | "error">;
  requestTimeoutMs?: number;
}

export interface TelegramRecipientFailure {
  recipientIndex: number;
  recipientKey: string;
  recipientMaskedId: string;
  status?: number;
  responseBody?: string;
  errorMessage?: string;
}

export const DEFAULT_TELEGRAM_REQUEST_TIMEOUT_MS = 15_000;

export class TelegramNotificationDeliveryError extends Error {
  constructor(
    readonly failures: TelegramRecipientFailure[],
    readonly attemptedRecipientCount: number
  ) {
    const detail = failures
      .map((failure) => {
        const recipient = `recipient ${failure.recipientIndex} (${failure.recipientMaskedId})`;

        if (failure.status) {
          return `${recipient} failed with ${failure.status}${
            failure.responseBody ? `: ${failure.responseBody}` : ""
          }`;
        }

        return `${recipient} failed${
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

function formatProtocolLabel(value: string): string {
  return value.trim().toLowerCase() === "cow" ? "CoW" : titleCase(value);
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

function truncateDeliveryDetail(value: string): string {
  const maxLength = 1_000;

  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 3)}...`;
}

async function readTelegramApiFailure(
  response: Response,
  redact: (value: string) => string
): Promise<{ status: number; responseBody: string } | null> {
  const rawResponseBody = await response.text().catch(() => "");
  const responseBody = truncateDeliveryDetail(redact(rawResponseBody));

  if (!response.ok) {
    return { status: response.status, responseBody };
  }

  try {
    const payload = JSON.parse(rawResponseBody) as { ok?: unknown };

    return payload.ok === true
      ? null
      : { status: response.status, responseBody };
  } catch {
    return { status: response.status, responseBody };
  }
}

function maskTelegramUserId(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length <= 4) {
    return "[redacted]";
  }

  return `${"*".repeat(trimmed.length - 4)}${trimmed.slice(-4)}`;
}

export function createTelegramRecipientKey(userId: string): string {
  return sha256(`telegram:${userId.trim()}`);
}

export function formatTelegramGovernanceMessage(
  message: NotificationMessage
): string {
  return [
    "<b>NEW GOVERNANCE ITEM TRACKED</b>",
    `Protocol: ${escapeTelegramHtml(formatProtocolLabel(message.protocol))}`,
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
  private readonly recipients: Array<
    NotificationRecipient & { userId: string; recipientIndex: number }
  >;
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: Pick<Logger, "debug" | "error">;
  private readonly requestTimeoutMs: number;

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
    this.recipients = allowedUserIds.map((userId, index) => ({
      key: createTelegramRecipientKey(userId),
      maskedId: maskTelegramUserId(userId),
      userId,
      recipientIndex: index + 1
    }));
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_TELEGRAM_REQUEST_TIMEOUT_MS;
  }

  getRecipients(): readonly NotificationRecipient[] {
    return this.recipients.map(({ key, maskedId }) => ({ key, maskedId }));
  }

  async send(
    message: NotificationMessage,
    recipientKeys?: readonly string[]
  ): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const text = formatTelegramGovernanceMessage(message);
    const targetKeys = recipientKeys ? new Set(recipientKeys) : null;
    const targetRecipients = targetKeys
      ? this.recipients.filter((recipient) => targetKeys.has(recipient.key))
      : this.recipients;

    if (targetKeys) {
      const configuredKeys = new Set(this.recipients.map((recipient) => recipient.key));
      const unknownKeys = [...targetKeys].filter((key) => !configuredKeys.has(key));

      if (unknownKeys.length > 0) {
        throw new Error(
          `Telegram notification requested ${unknownKeys.length} unknown recipient key(s).`
        );
      }
    }

    this.logger?.debug(
      {
        notificationService: this.name,
        allowedRecipientCount: this.allowedUserIds.length,
        targetRecipientCount: targetRecipients.length
      },
      "Sending Telegram governance notification"
    );

    const failures: TelegramRecipientFailure[] = [];

    for (const recipient of targetRecipients) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.requestTimeoutMs
      );

      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          signal: controller.signal,
          body: JSON.stringify({
            chat_id: recipient.userId,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: false
          })
        });

        const apiFailure = await readTelegramApiFailure(response, (value) =>
          redactTelegramSensitiveValues(
            value,
            this.botToken,
            this.allowedUserIds
          )
        );

        if (apiFailure) {
          const failure = {
            recipientIndex: recipient.recipientIndex,
            recipientKey: recipient.key,
            recipientMaskedId: recipient.maskedId,
            status: apiFailure.status,
            responseBody: apiFailure.responseBody
          };

          failures.push(failure);
          this.logger?.error(
            {
              notificationService: this.name,
              recipientIndex: recipient.recipientIndex,
              status: apiFailure.status,
              responseBody: apiFailure.responseBody
            },
            "Telegram notification failed for allowed recipient"
          );
        }
      } catch (error) {
        const rawErrorMessage = controller.signal.aborted
          ? `Telegram notification request timed out after ${this.requestTimeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
        const errorMessage = truncateDeliveryDetail(
          redactTelegramSensitiveValues(
            rawErrorMessage,
            this.botToken,
            this.allowedUserIds
          )
        );
        const failure = {
          recipientIndex: recipient.recipientIndex,
          recipientKey: recipient.key,
          recipientMaskedId: recipient.maskedId,
          errorMessage
        };

        failures.push(failure);
        this.logger?.error(
          {
            notificationService: this.name,
            recipientIndex: recipient.recipientIndex,
            errorMessage
          },
          "Telegram notification request failed for allowed recipient"
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    if (failures.length > 0) {
      throw new TelegramNotificationDeliveryError(
        failures,
        targetRecipients.length
      );
    }
  }
}

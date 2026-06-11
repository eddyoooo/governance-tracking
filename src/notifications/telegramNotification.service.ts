import type { Logger } from "pino";
import type {
  NotificationMessage,
  NotificationService
} from "./notification.service.js";

export interface TelegramNotificationServiceOptions {
  botToken: string;
  chatId: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Logger, "debug" | "error">;
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

export function formatTelegramGovernanceMessage(
  message: NotificationMessage
): string {
  return [
    "New governance item tracked",
    `Protocol: ${titleCase(message.protocol)}`,
    `Source: ${titleCase(message.sourceType)}`,
    `Publisher: ${message.publisherName}`,
    `Title: ${message.title}`,
    `Link: ${message.sourceUrl}`
  ].join("\n");
}

export class TelegramNotificationService implements NotificationService {
  readonly name = "telegram";
  readonly enabled = true;
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: Pick<Logger, "debug" | "error">;

  constructor(options: TelegramNotificationServiceOptions) {
    this.botToken = options.botToken;
    this.chatId = options.chatId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger;
  }

  async send(message: NotificationMessage): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const text = formatTelegramGovernanceMessage(message);

    this.logger?.debug(
      { notificationService: this.name },
      "Sending Telegram governance notification"
    );

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        disable_web_page_preview: false
      })
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      this.logger?.error(
        {
          notificationService: this.name,
          status: response.status,
          responseBody
        },
        "Telegram notification failed"
      );
      throw new Error(
        `Telegram notification failed with ${response.status}${
          responseBody ? `: ${responseBody}` : ""
        }`
      );
    }
  }
}

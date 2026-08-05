import type {
  NotificationMessage,
  NotificationRecipient,
  NotificationService
} from "./notification.service.js";

export class NoopNotificationService implements NotificationService {
  readonly name = "noop";
  readonly enabled = false;

  getRecipients(): readonly NotificationRecipient[] {
    return [];
  }

  async send(
    _message: NotificationMessage,
    _recipientKeys?: readonly string[]
  ): Promise<void> {
    return undefined;
  }
}

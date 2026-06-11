import type {
  NotificationMessage,
  NotificationService
} from "./notification.service.js";

export class NoopNotificationService implements NotificationService {
  readonly name = "noop";
  readonly enabled = false;

  async send(_message: NotificationMessage): Promise<void> {
    return undefined;
  }
}

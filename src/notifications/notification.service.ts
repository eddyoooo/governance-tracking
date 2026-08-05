export interface NotificationMessage {
  protocol: string;
  sourceType: string;
  publisherName: string;
  title: string;
  sourceUrl: string;
}

export interface NotificationRecipient {
  key: string;
  maskedId: string;
}

export interface NotificationService {
  readonly name: string;
  readonly enabled: boolean;
  getRecipients(): readonly NotificationRecipient[];
  send(message: NotificationMessage, recipientKeys?: readonly string[]): Promise<void>;
}

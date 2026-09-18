export interface ProposalNotificationMessage {
  kind?: "proposal";
  protocol: string;
  sourceType: string;
  publisherName: string;
  title: string;
  sourceUrl: string;
}

export interface LifecycleNotificationField {
  label: string;
  value: string;
}

export interface LifecycleNotificationMessage {
  kind: "lifecycle";
  heading: string;
  protocol: string;
  sourceType: string;
  title: string;
  sourceUrl: string;
  fields: LifecycleNotificationField[];
}

export type NotificationMessage =
  | ProposalNotificationMessage
  | LifecycleNotificationMessage;

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

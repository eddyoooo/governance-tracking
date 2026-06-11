export interface NotificationMessage {
  protocol: string;
  sourceType: string;
  publisherName: string;
  title: string;
  sourceUrl: string;
}

export interface NotificationService {
  readonly name: string;
  readonly enabled: boolean;
  send(message: NotificationMessage): Promise<void>;
}

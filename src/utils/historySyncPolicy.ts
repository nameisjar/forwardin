import { proto } from '@whiskeysockets/baileys';

type HistorySyncRequest = proto.Message.IHistorySyncNotification;

/**
 * Allow the protocol/bootstrap history required for LID mappings, app-state
 * and trusted-contact tokens, while continuing to reject the account's full
 * chat archive. The Inbox does not subscribe to `messaging-history.set`, so
 * processing these records internally does not import old chats into Inbox.
 */
export function shouldProcessHistorySync({ syncType }: HistorySyncRequest): boolean {
    return syncType !== proto.Message.HistorySyncType.FULL;
}

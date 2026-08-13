/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import type { PrismaClient } from '@prisma/client';
import prisma from './db';
import logger from '../config/logger';
import { decrypt, encrypt } from './encryption';

const fixId = (id: string) => id.replace(/\//g, '__').replace(/:/g, '-');
const SESSION_TRANSACTION_MAX_WAIT_MS = 10_000;
const SESSION_TRANSACTION_TIMEOUT_MS = 60_000;

const signalKeyTypes = [
    'app-state-sync-key',
    'app-state-sync-version',
    'sender-key-memory',
    'identity-key',
    'lid-mapping',
    'device-list',
    'sender-key',
    'pre-key',
    'tctoken',
    'session',
] as const;

const getKeyType = (id: string): string => {
    if (id === 'creds') return id;
    return signalKeyTypes.find(type => id.startsWith(`${type}-`)) || 'unknown';
};

type SessionDatabase = PrismaClient;
type SessionModel = Pick<PrismaClient['session'], 'findUnique' | 'upsert' | 'deleteMany'>;

type SessionReadResult =
    | { found: false }
    | { found: true; value: any };

/**
 * Raised when a persisted WhatsApp key exists but cannot be decrypted or decoded.
 * A corrupt credential must never be treated as a brand-new, unpaired identity.
 */
export class SessionDataCorruptionError extends Error {
    public readonly cause: unknown;

    constructor(keyType: string, cause: unknown) {
        super(`Persisted WhatsApp session data is corrupt (${keyType})`);
        this.name = 'SessionDataCorruptionError';
        this.cause = cause;
    }
}

export async function useSession(
    sessionId: string,
    deviceId: number,
    database: SessionDatabase = prisma,
) {
    const model = database.session;

    const serialize = (data: any): string => {
        return encrypt(JSON.stringify(data, BufferJSON.replacer));
    };

    const writeTo = async (target: SessionModel, data: any, id: string): Promise<void> => {
        const serialized = serialize(data);
        const normalizedId = fixId(id);

        await target.upsert({
            select: { pkId: true },
            create: { data: serialized, id: normalizedId, sessionId, deviceId },
            update: { data: serialized, deviceId },
            where: { sessionId_id: { id: normalizedId, sessionId } },
        });
    };

    const deleteFrom = async (target: SessionModel, id: string): Promise<void> => {
        // deleteMany makes deletion idempotent without hiding actual database errors.
        await target.deleteMany({
            where: { id: fixId(id), sessionId },
        });
    };

    const write = async (data: any, id: string): Promise<void> => {
        try {
            await writeTo(model, data, id);
        } catch (error) {
            logger.error(
                { error, sessionId, deviceId, keyType: getKeyType(id) },
                'Failed to persist WhatsApp session data',
            );
            throw error;
        }
    };

    const read = async (id: string): Promise<SessionReadResult> => {
        let record: { data: string } | null;

        try {
            record = await model.findUnique({
                select: { data: true },
                where: { sessionId_id: { id: fixId(id), sessionId } },
            });
        } catch (error) {
            logger.error(
                { error, sessionId, deviceId, keyType: getKeyType(id) },
                'Failed to read WhatsApp session data',
            );
            throw error;
        }

        if (!record) {
            logger.debug(
                { sessionId, deviceId, keyType: getKeyType(id) },
                'WhatsApp session data does not exist',
            );
            return { found: false };
        }

        try {
            const decrypted = decrypt(record.data);
            return {
                found: true,
                value: JSON.parse(decrypted, BufferJSON.reviver),
            };
        } catch (cause) {
            const error = new SessionDataCorruptionError(getKeyType(id), cause);
            logger.error(
                { error, sessionId, deviceId, keyType: getKeyType(id) },
                'Persisted WhatsApp session data cannot be decoded',
            );
            throw error;
        }
    };

    const credsResult = await read('creds');
    const creds: AuthenticationCreds = credsResult.found
        ? credsResult.value as AuthenticationCreds
        : initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async <T extends keyof SignalDataTypeMap>(
                    type: T,
                    ids: string[],
                ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
                    const data: { [id: string]: SignalDataTypeMap[T] } = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            const result = await read(`${type}-${id}`);
                            if (!result.found) {
                                data[id] = null as unknown as SignalDataTypeMap[T];
                                return;
                            }

                            let value = result.value;
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value as SignalDataTypeMap[T];
                        }),
                    );
                    return data;
                },
                set: async (data: any): Promise<void> => {
                    try {
                        // One Baileys keys.set call is one persistence unit. Keeping all
                        // key mutations in a transaction prevents a token and its index,
                        // or related Signal keys, from being only partially committed.
                        await database.$transaction(
                            async transaction => {
                                const transactionModel = transaction.session;
                                const tasks: Promise<void>[] = [];

                                for (const category in data) {
                                    for (const id in data[category]) {
                                        const value = data[category][id];
                                        const storageId = `${category}-${id}`;
                                        tasks.push(
                                            value
                                                ? writeTo(transactionModel, value, storageId)
                                                : deleteFrom(transactionModel, storageId),
                                        );
                                    }
                                }

                                await Promise.all(tasks);
                            },
                            {
                                maxWait: SESSION_TRANSACTION_MAX_WAIT_MS,
                                // Initial pairing may persist hundreds of pre-keys in
                                // one batch, so use a bounded but realistic timeout.
                                timeout: SESSION_TRANSACTION_TIMEOUT_MS,
                            },
                        );
                    } catch (error) {
                        logger.error(
                            { error, sessionId, deviceId, keyTypes: Object.keys(data) },
                            'Failed to atomically persist WhatsApp signal keys',
                        );
                        throw error;
                    }
                },
            },
        },
        saveCreds: () => write(creds, 'creds'),
    };
}

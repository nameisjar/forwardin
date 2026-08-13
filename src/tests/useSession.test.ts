/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import type { PrismaClient } from '@prisma/client';
import { SessionDataCorruptionError, useSession } from '../utils/useSession';

type StoredSession = {
    pkId: number;
    id: string;
    sessionId: string;
    deviceId: number;
    data: string;
};

class FakeSessionDatabase {
    public readonly rows = new Map<string, StoredSession>();
    public transactionCalls = 0;
    public failFindId?: string;
    public failUpsertId?: string;
    public failDeleteId?: string;
    public readonly session: any;
    private nextPkId = 1;

    constructor() {
        this.session = this.createSessionModel(this.rows);
    }

    public asPrisma(): PrismaClient {
        return this as unknown as PrismaClient;
    }

    public seed(sessionId: string, id: string, data: string, deviceId = 1): void {
        this.rows.set(this.rowKey(sessionId, id), {
            pkId: this.nextPkId++,
            id,
            sessionId,
            deviceId,
            data,
        });
    }

    public has(sessionId: string, id: string): boolean {
        return this.rows.has(this.rowKey(sessionId, id));
    }

    public async $transaction<T>(work: (transaction: any) => Promise<T>): Promise<T> {
        this.transactionCalls += 1;
        const pendingRows = new Map(
            [...this.rows].map(([key, value]) => [key, { ...value }]),
        );
        const result = await work({ session: this.createSessionModel(pendingRows) });

        this.rows.clear();
        for (const [key, value] of pendingRows) {
            this.rows.set(key, value);
        }
        return result;
    }

    private rowKey(sessionId: string, id: string): string {
        return `${sessionId}\u0000${id}`;
    }

    private createSessionModel(rows: Map<string, StoredSession>) {
        return {
            findUnique: async (args: any) => {
                const { sessionId, id } = args.where.sessionId_id;
                if (id === this.failFindId) throw new Error('database read failed');
                const row = rows.get(this.rowKey(sessionId, id));
                return row ? { data: row.data } : null;
            },
            upsert: async (args: any) => {
                const { sessionId, id } = args.where.sessionId_id;
                if (id === this.failUpsertId) throw new Error('database write failed');

                const key = this.rowKey(sessionId, id);
                const existing = rows.get(key);
                const row: StoredSession = existing
                    ? { ...existing, ...args.update }
                    : { pkId: this.nextPkId++, ...args.create };
                rows.set(key, row);
                return { pkId: row.pkId };
            },
            deleteMany: async (args: any) => {
                const { sessionId, id } = args.where;
                if (id === this.failDeleteId) throw new Error('database delete failed');
                const deleted = rows.delete(this.rowKey(sessionId, id));
                return { count: deleted ? 1 : 0 };
            },
        };
    }
}

async function captureFailure(operation: Promise<unknown>): Promise<unknown> {
    let failed = false;
    try {
        await operation;
    } catch (error) {
        failed = true;
        return error;
    }

    if (!failed) throw new Error('Expected operation to fail');
}

describe('useSession persistence', () => {
    const sessionId = 'session-under-test';
    const deviceId = 42;

    it('initializes credentials only when the creds row does not exist', async () => {
        const database = new FakeSessionDatabase();
        const session = await useSession(sessionId, deviceId, database.asPrisma());

        expect(session.state.creds).to.have.property('noiseKey');
        expect(session.state.creds.registered).to.equal(false);
    });

    it('rejects a corrupt creds row instead of silently creating a new identity', async () => {
        const database = new FakeSessionDatabase();
        database.seed(sessionId, 'creds', '{"truncated":');

        const error = await captureFailure(
            useSession(sessionId, deviceId, database.asPrisma()),
        );

        expect(error).to.be.instanceOf(SessionDataCorruptionError);
        expect((error as Error).message).to.contain('(creds)');
    });

    it('propagates a credential read failure instead of treating it as not found', async () => {
        const database = new FakeSessionDatabase();
        database.failFindId = 'creds';

        const error = await captureFailure(
            useSession(sessionId, deviceId, database.asPrisma()),
        );

        expect((error as Error).message).to.equal('database read failed');
    });

    it('rejects corrupt signal-key data instead of reporting the key as missing', async () => {
        const database = new FakeSessionDatabase();
        database.seed(sessionId, 'tctoken-contact@lid', '{"truncated":');
        const session = await useSession(sessionId, deviceId, database.asPrisma());

        const error = await captureFailure(
            session.state.keys.get('tctoken', ['contact@lid']),
        );

        expect(error).to.be.instanceOf(SessionDataCorruptionError);
        expect((error as Error).message).to.contain('(tctoken)');
    });

    it('propagates credential write failures', async () => {
        const database = new FakeSessionDatabase();
        const session = await useSession(sessionId, deviceId, database.asPrisma());
        database.failUpsertId = 'creds';

        const error = await captureFailure(session.saveCreds());

        expect((error as Error).message).to.equal('database write failed');
        expect(database.has(sessionId, 'creds')).to.equal(false);
    });

    it('propagates signal-key deletion failures', async () => {
        const database = new FakeSessionDatabase();
        const session = await useSession(sessionId, deviceId, database.asPrisma());
        database.failDeleteId = 'tctoken-contact@lid';

        const error = await captureFailure(
            session.state.keys.set({ tctoken: { 'contact@lid': null } }),
        );

        expect((error as Error).message).to.equal('database delete failed');
    });

    it('rolls back the whole keys.set batch when one key cannot be written', async () => {
        const database = new FakeSessionDatabase();
        const session = await useSession(sessionId, deviceId, database.asPrisma());
        database.failUpsertId = 'tctoken-second@lid';

        await captureFailure(session.state.keys.set({
            tctoken: {
                'first@lid': { token: Buffer.from('first'), timestamp: '100' },
                'second@lid': { token: Buffer.from('second'), timestamp: '100' },
            },
        }));

        expect(database.transactionCalls).to.equal(1);
        expect(database.has(sessionId, 'tctoken-first@lid')).to.equal(false);
        expect(database.has(sessionId, 'tctoken-second@lid')).to.equal(false);
    });

    it('round-trips tctoken buffers through one atomic transaction', async () => {
        const database = new FakeSessionDatabase();
        const session = await useSession(sessionId, deviceId, database.asPrisma());

        await session.state.keys.set({
            tctoken: {
                '123:4@lid': {
                    token: Buffer.from('trusted-contact-token'),
                    timestamp: '1786609070',
                },
            },
        });
        const stored = await session.state.keys.get('tctoken', ['123:4@lid']);

        expect(database.transactionCalls).to.equal(1);
        expect(database.has(sessionId, 'tctoken-123-4@lid')).to.equal(true);
        expect(Buffer.isBuffer(stored['123:4@lid'].token)).to.equal(true);
        expect(stored['123:4@lid'].token.toString()).to.equal('trusted-contact-token');
        expect(stored['123:4@lid'].timestamp).to.equal('1786609070');
    });
});

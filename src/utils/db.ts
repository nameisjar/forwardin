/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaClient } from '@prisma/client';
import { MakeSerializedPrisma, MakeTransformedPrisma } from '../types';
import Long from 'long';
import { toNumber } from '@whiskeysockets/baileys';

const prismaClientSingleton = () => {
    return new PrismaClient();
};

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClientSingleton | undefined;
};

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Transform object props value into Prisma-supported types */
export function transformPrisma<T extends Record<string, any>>(
    data: T,
    removeNullable = true,
): MakeTransformedPrisma<T> {
    const obj = { ...data } as any;

    for (const [key, val] of Object.entries(obj)) {
        if (val instanceof Uint8Array) {
            obj[key] = Buffer.from(val);
        } else if (typeof val === 'number' || val instanceof Long) {
            obj[key] = toNumber(val);
        } else if (removeNullable && (typeof val === 'undefined' || val === null)) {
            delete obj[key];
        }
    }

    return obj;
}

/** Transform prisma result into JSON serializable types */
export function serializePrisma<T extends Record<string, any>>(
    data: T,
    removeNullable = true,
): MakeSerializedPrisma<T> {
    const obj = { ...data } as any;

    for (const [key, val] of Object.entries(obj)) {
        if (val instanceof Buffer) {
            obj[key] = val.toJSON();
        } else if (typeof val === 'bigint' || val instanceof BigInt) {
            obj[key] = val.toString();
        } else if (removeNullable && (typeof val === 'undefined' || val === null)) {
            delete obj[key];
        }
    }

    return obj;
}

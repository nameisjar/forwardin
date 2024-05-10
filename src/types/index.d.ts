/* eslint-disable @typescript-eslint/no-explicit-any */
import { Privilege, Subscription, Session } from '@prisma/client';
import { Session } from 'inspector';

type authenticatedUser = {
    pkId;
    id;
    firstName?;
    lastName?;
    username;
    phone?;
    email;
    password;
    accountApiKey?;
    googleId?;
    privilegeId;
    userId?;
    deviceId?;
    affiliationCode?;
    emailOtpSecret?;
    refreshToken?;
    createdAt;
    updatedAt;
    deletedAt?;
    emailVerifiedAt?;
};

type accessTokenPayload = {
    email: string;
};

type refreshTokenPayload = {
    id: string;
};

declare global {
    namespace Express {
        interface Request {
            authenticatedUser: authenticatedUser;
            privilege: Privilege;
            subscription: Subscription;
            authenticatedDevice: Session;
        }
    }
}

export type BaileysEventHandler<T extends keyof BaileysEventMap> = (
    args: BaileysEventMap[T],
) => void;

type TransformPrisma<T, TransformObject> = T extends Long
    ? number
    : T extends Uint8Array
    ? Buffer
    : T extends null
    ? never
    : T extends object
    ? TransformObject extends true
        ? object
        : T
    : T;

/** Transform unsupported types into supported Prisma types */
export type MakeTransformedPrisma<
    T extends Record<string, any>,
    TransformObject extends boolean = true,
> = {
    [K in keyof T]: TransformPrisma<T[K], TransformObject>;
};

type SerializePrisma<T> = T extends Buffer
    ? {
          type: 'Buffer';
          data: number[];
      }
    : T extends bigint
    ? string
    : T extends null
    ? never
    : T;

export type MakeSerializedPrisma<T extends Record<string, any>> = {
    [K in keyof T]: SerializePrisma<T[K]>;
};

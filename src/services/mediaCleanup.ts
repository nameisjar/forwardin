import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import logger from '../config/logger';
import prisma from '../utils/db';

const MEDIA_ROOT = path.resolve(process.cwd(), 'media');
export const ORPHAN_MEDIA_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface MediaCleanupResult {
    requested: number;
    deleted: number;
    missing: number;
    referenced: number;
    unsafe: number;
    failed: number;
}

interface MediaCandidate {
    filePath: string;
    lookupPaths: Set<string>;
}

const emptyResult = (): MediaCleanupResult => ({
    requested: 0,
    deleted: 0,
    missing: 0,
    referenced: 0,
    unsafe: 0,
    failed: 0,
});

/** Resolve only regular media paths contained by the application's media root. */
export function resolveSafeMediaFile(mediaPath: string | null | undefined): string | null {
    if (!mediaPath) return null;
    const value = mediaPath.trim();
    if (!value || value.startsWith('data:') || /^https?:\/\//i.test(value)) return null;

    const candidate = path.resolve(process.cwd(), value);
    const relative = path.relative(MEDIA_ROOT, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return candidate;
}

function lookupVariants(rawPath: string, filePath: string): Set<string> {
    const relative = path.relative(process.cwd(), filePath);
    return new Set([
        rawPath,
        rawPath.replace(/\\/g, '/'),
        rawPath.replace(/\//g, path.sep),
        relative,
        relative.replace(/\\/g, '/'),
        filePath,
        filePath.replace(/\\/g, '/'),
    ]);
}

function candidateKey(filePath: string): string {
    return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}

async function findReferencedPaths(paths: string[]): Promise<Set<string>> {
    const referenced = new Set<string>();
    const chunkSize = 500;

    for (let index = 0; index < paths.length; index += chunkSize) {
        const chunk = paths.slice(index, index + chunkSize);
        const where = { mediaPath: { in: chunk } };
        const results = await Promise.all([
            prisma.incomingMessage.findMany({
                where,
                select: { mediaPath: true },
                distinct: ['mediaPath'],
            }),
            prisma.outgoingMessage.findMany({
                where,
                select: { mediaPath: true },
                distinct: ['mediaPath'],
            }),
            prisma.broadcast.findMany({
                where,
                select: { mediaPath: true },
                distinct: ['mediaPath'],
            }),
            prisma.autoReply.findMany({
                where,
                select: { mediaPath: true },
                distinct: ['mediaPath'],
            }),
            prisma.campaign.findMany({
                where,
                select: { mediaPath: true },
                distinct: ['mediaPath'],
            }),
            prisma.campaignMessage.findMany({
                where,
                select: { mediaPath: true },
                distinct: ['mediaPath'],
            }),
        ]);

        for (const rows of results) {
            for (const row of rows) {
                if (row.mediaPath) referenced.add(row.mediaPath);
            }
        }
    }

    return referenced;
}

/**
 * Delete local media files only after their database rows have been removed.
 * Shared broadcast/campaign files remain untouched while any model references them.
 */
export async function cleanupMediaFilesIfUnreferenced(
    mediaPaths: Array<string | null | undefined>,
    reason: string,
): Promise<MediaCleanupResult> {
    const result = emptyResult();
    const candidates = new Map<string, MediaCandidate>();

    for (const rawPath of new Set(mediaPaths.filter((item): item is string => Boolean(item)))) {
        const filePath = resolveSafeMediaFile(rawPath);
        if (!filePath) {
            result.unsafe += 1;
            continue;
        }

        const key = candidateKey(filePath);
        const existing = candidates.get(key);
        const variants = lookupVariants(rawPath, filePath);
        if (existing) {
            variants.forEach((variant) => existing.lookupPaths.add(variant));
        } else {
            candidates.set(key, { filePath, lookupPaths: variants });
        }
    }

    result.requested = candidates.size;
    if (candidates.size === 0) return result;

    const allLookupPaths = Array.from(
        new Set(Array.from(candidates.values()).flatMap((candidate) => [...candidate.lookupPaths])),
    );
    let referencedPaths: Set<string>;
    try {
        referencedPaths = await findReferencedPaths(allLookupPaths);
    } catch (error) {
        // Message deletion is already committed before this helper runs. A
        // cleanup lookup failure must not turn a successful delete into a 500.
        result.failed += candidates.size;
        logger.warn(
            { code: (error as { code?: unknown })?.code, reason },
            'Unable to verify media references; files were retained',
        );
        return result;
    }

    for (const candidate of candidates.values()) {
        if ([...candidate.lookupPaths].some((variant) => referencedPaths.has(variant))) {
            result.referenced += 1;
            continue;
        }

        try {
            const stat = await fs.lstat(candidate.filePath);
            if (!stat.isFile() && !stat.isSymbolicLink()) {
                result.unsafe += 1;
                continue;
            }
            await fs.unlink(candidate.filePath);
            result.deleted += 1;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                result.missing += 1;
            } else {
                result.failed += 1;
                logger.warn(
                    { code: (error as NodeJS.ErrnoException).code, reason },
                    'Failed to delete unreferenced media file',
                );
            }
        }
    }

    if (result.deleted || result.failed) {
        logger.info({ ...result, reason }, 'Media cleanup completed');
    }
    return result;
}

async function collectOldMediaFiles(directory: string, cutoffMs: number): Promise<string[]> {
    let entries: Dirent[];
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }

    const files: string[] = [];
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectOldMediaFiles(entryPath, cutoffMs)));
            continue;
        }
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        const stat = await fs.lstat(entryPath);
        if (stat.mtimeMs <= cutoffMs) files.push(entryPath);
    }
    return files;
}

/** Remove files that have had no database reference for at least one day. */
export async function cleanupOrphanedMediaFiles(
    minAgeMs = ORPHAN_MEDIA_MIN_AGE_MS,
): Promise<MediaCleanupResult> {
    try {
        const cutoffMs = Date.now() - Math.max(0, minAgeMs);
        const candidates = await collectOldMediaFiles(MEDIA_ROOT, cutoffMs);
        return cleanupMediaFilesIfUnreferenced(candidates, 'scheduled-orphan-cleanup');
    } catch (error) {
        logger.warn(
            { code: (error as NodeJS.ErrnoException).code },
            'Unable to scan orphaned media files',
        );
        return { ...emptyResult(), failed: 1 };
    }
}

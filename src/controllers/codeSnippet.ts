import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';
import crypto from 'crypto';

const MAX_CODE_SIZE = 50 * 1024; // 50KB limit per snippet

// Generate random share token
const generateShareToken = (): string => {
    return crypto.randomBytes(32).toString('hex'); // 64 chars
};

// Create a new code snippet
export const createSnippet: RequestHandler = async (req, res) => {
    try {
        const userId = req.authenticatedUser.pkId;
        const { title, description, code, language } = req.body;

        // Validate required fields
        if (!title || !code || !language) {
            return res.status(400).json({ message: 'Title, code, and language are required' });
        }

        // Check code size
        const codeSize = Buffer.byteLength(code, 'utf8');
        if (codeSize > MAX_CODE_SIZE) {
            return res.status(400).json({ 
                message: `Code size exceeds limit. Maximum allowed: ${MAX_CODE_SIZE / 1024}KB, got: ${(codeSize / 1024).toFixed(2)}KB` 
            });
        }

        const snippet = await prisma.codeSnippet.create({
            data: {
                title,
                description: description || null,
                code,
                language,
                shareToken: generateShareToken(),
                userId,
            },
            select: {
                id: true,
                title: true,
                description: true,
                code: true,
                language: true,
                shareToken: true,
                isPublic: true,
                viewCount: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        res.status(201).json({ message: 'Snippet created successfully', snippet });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Get all snippets for current user
export const getSnippets: RequestHandler = async (req, res) => {
    try {
        const userId = req.authenticatedUser.pkId;
        const { search, language } = req.query;

        const snippets = await prisma.codeSnippet.findMany({
            where: {
                userId,
                ...(search && {
                    OR: [
                        { title: { contains: String(search), mode: 'insensitive' } },
                        { description: { contains: String(search), mode: 'insensitive' } },
                    ],
                }),
                ...(language && { language: String(language) }),
            },
            select: {
                id: true,
                title: true,
                description: true,
                code: true,
                language: true,
                shareToken: true,
                isPublic: true,
                viewCount: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        res.status(200).json(snippets);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Get single snippet by ID (owner only)
export const getSnippetById: RequestHandler = async (req, res) => {
    try {
        const userId = req.authenticatedUser.pkId;
        const { id } = req.params;

        const snippet = await prisma.codeSnippet.findFirst({
            where: { id, userId },
            select: {
                id: true,
                title: true,
                description: true,
                code: true,
                language: true,
                shareToken: true,
                isPublic: true,
                viewCount: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!snippet) {
            return res.status(404).json({ message: 'Snippet not found' });
        }

        res.status(200).json(snippet);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Update snippet
export const updateSnippet: RequestHandler = async (req, res) => {
    try {
        const userId = req.authenticatedUser.pkId;
        const { id } = req.params;
        const { title, description, code, language, isPublic } = req.body;

        // Check ownership
        const existing = await prisma.codeSnippet.findFirst({
            where: { id, userId },
        });

        if (!existing) {
            return res.status(404).json({ message: 'Snippet not found' });
        }

        // Check code size if code is being updated
        if (code) {
            const codeSize = Buffer.byteLength(code, 'utf8');
            if (codeSize > MAX_CODE_SIZE) {
                return res.status(400).json({ 
                    message: `Code size exceeds limit. Maximum allowed: ${MAX_CODE_SIZE / 1024}KB, got: ${(codeSize / 1024).toFixed(2)}KB` 
                });
            }
        }

        const snippet = await prisma.codeSnippet.update({
            where: { id },
            data: {
                ...(title && { title }),
                ...(description !== undefined && { description }),
                ...(code && { code }),
                ...(language && { language }),
                ...(isPublic !== undefined && { isPublic }),
                updatedAt: new Date(),
            },
            select: {
                id: true,
                title: true,
                description: true,
                code: true,
                language: true,
                shareToken: true,
                isPublic: true,
                viewCount: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        res.status(200).json({ message: 'Snippet updated successfully', snippet });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Delete snippet(s)
export const deleteSnippets: RequestHandler = async (req, res) => {
    try {
        const userId = req.authenticatedUser.pkId;
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'ids must be a non-empty array' });
        }

        // Delete only snippets owned by user
        const result = await prisma.codeSnippet.deleteMany({
            where: {
                id: { in: ids },
                userId,
            },
        });

        res.status(200).json({ message: `${result.count} snippet(s) deleted successfully` });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Regenerate share token (revoke old link, create new one)
export const regenerateShareToken: RequestHandler = async (req, res) => {
    try {
        const userId = req.authenticatedUser.pkId;
        const { id } = req.params;

        // Check ownership
        const existing = await prisma.codeSnippet.findFirst({
            where: { id, userId },
        });

        if (!existing) {
            return res.status(404).json({ message: 'Snippet not found' });
        }

        const snippet = await prisma.codeSnippet.update({
            where: { id },
            data: {
                shareToken: generateShareToken(),
                updatedAt: new Date(),
            },
            select: {
                id: true,
                shareToken: true,
            },
        });

        res.status(200).json({ message: 'Share link regenerated', snippet });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// PUBLIC: Get snippet by share token (no auth required)
export const getSnippetByShareToken: RequestHandler = async (req, res) => {
    try {
        const { token } = req.params;

        const snippet = await prisma.codeSnippet.findUnique({
            where: { shareToken: token },
            select: {
                id: true,
                title: true,
                description: true,
                code: true,
                language: true,
                isPublic: true,
                viewCount: true,
                createdAt: true,
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                    },
                },
            },
        });

        if (!snippet) {
            return res.status(404).json({ message: 'Snippet not found' });
        }

        if (!snippet.isPublic) {
            return res.status(403).json({ message: 'This snippet is not publicly accessible' });
        }

        // Increment view count (fire and forget)
        prisma.codeSnippet
            .update({
                where: { shareToken: token },
                data: { viewCount: { increment: 1 } },
            })
            .catch(() => {}); // Ignore errors

        res.status(200).json(snippet);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

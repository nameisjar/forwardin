import { RequestHandler } from 'express';
import {
    createInstance,
    deleteInstance,
    getInstance,
    getInstanceStatus,
    getJid,
    verifyInstance,
    markSSEAborted,
    getActiveSSEConnections, // 🆕 Import untuk akses Map
} from '../whatsapp';
import prisma from '../utils/db';
import { generateUuid } from '../utils/keyGenerator';
import logger from '../config/logger';
import { isUUID } from '../utils/uuidChecker';

// one device, one session
// one whatsapp number, multiple devices == one whatsapp number, multiple sessions
export const createSession: RequestHandler = async (req, res) => {
    try {
        const { deviceId } = req.body;
        const sessionId = generateUuid();

        const existingDevice = await prisma.device.findUnique({
            where: { id: deviceId },
        });

        if (!existingDevice) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const existingSession = await prisma.session.findFirst({
            where: { deviceId: existingDevice.pkId, device: { status: 'open' } },
        });

        if (existingSession) {
            return res.status(404).json({ message: 'This device is already linked.' });
        }

        createInstance({ sessionId, deviceId: existingDevice.pkId, res });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createSSE: RequestHandler = async (req, res) => {
    const { deviceId } = req.body;
    const sessionId = generateUuid();

    // Set proper SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial heartbeat
    res.write(`data: ${JSON.stringify({ connection: 'initializing', sessionId })}\n\n`);

    // 🆕 Setup timeout untuk SSE (60 detik max untuk pairing)
    const SSE_TIMEOUT = 60000; // 60 seconds
    const timeoutId = setTimeout(() => {
        if (!res.writableEnded) {
            logger.warn({ sessionId, deviceId }, 'SSE timeout reached - closing connection');
            res.write(
                `data: ${JSON.stringify({
                    error: 'Pairing timeout. Silakan coba lagi.',
                    timeout: true,
                })}\n\n`,
            );
            setTimeout(() => {
                if (!res.writableEnded) {
                    res.end();
                }
            }, 500);
        }
    }, SSE_TIMEOUT);

    // 🆕 Cleanup function
    const cleanup = () => {
        clearTimeout(timeoutId);
        if (!res.writableEnded) {
            res.end();
        }
    };

    // 🆕 Handle client disconnect - mark SSE as aborted
    req.on('close', () => {
        logger.info({ sessionId, deviceId }, 'Client closed SSE connection - marking as aborted');
        
        prisma.device.findUnique({
            where: { id: deviceId },
        }).then(device => {
            if (device) {
                markSSEAborted(device.pkId);
            }
        });
        
        cleanup();
    });

    try {
        const existingDevice = await prisma.device.findUnique({
            where: { id: deviceId },
        });

        if (!existingDevice) {
            res.write(`data: ${JSON.stringify({ error: 'Device tidak ditemukan' })}\n\n`);
            cleanup();
            return;
        }

        // 🆕 CRITICAL FIX: Force clear old SSE connection untuk device ini
        const activeSSEMap = getActiveSSEConnections();
        const existingConnection = activeSSEMap.get(existingDevice.pkId);
        
        if (existingConnection) {
            logger.warn(
                { 
                    deviceId: existingDevice.pkId, 
                    oldSessionId: existingConnection.sessionId,
                    newSessionId: sessionId 
                }, 
                '🔧 [RACE CONDITION FIX] Found existing SSE connection - force clearing before creating new one'
            );
            
            // Mark old connection as aborted
            existingConnection.aborted = true;
            
            // Delete dari Map
            activeSSEMap.delete(existingDevice.pkId);
            
            // Destroy old instance if exists
            if (verifyInstance(existingConnection.sessionId)) {
                logger.info(
                    { oldSessionId: existingConnection.sessionId },
                    '🔧 Destroying old instance to prevent conflict'
                );
                await deleteInstance(existingConnection.sessionId);
            }
        }

        // Check if device already has an active session
        const existingSession = await prisma.session.findFirst({
            where: {
                deviceId: existingDevice.pkId,
                device: { status: 'open' },
            },
        });

        if (existingSession) {
            res.write(
                `data: ${JSON.stringify({
                    error: 'Device sudah terhubung. Disconnect terlebih dahulu untuk pairing ulang.',
                    alreadyConnected: true,
                })}\n\n`,
            );
            cleanup();
            return;
        }

        if (verifyInstance(sessionId)) {
            res.write(
                `data: ${JSON.stringify({
                    error: 'Sesi sudah ada. Silakan tunggu atau refresh halaman.',
                })}\n\n`,
            );
            cleanup();
            return;
        }

        // Send initial status
        res.write(`data: ${JSON.stringify({ connection: 'connecting', sessionId })}\n\n`);

        // 🆕 Pass cleanup function ke createInstance untuk force close SSE saat connected
        createInstance({ 
            sessionId, 
            deviceId: existingDevice.pkId, 
            res, 
            SSE: true,
            sseCleanup: cleanup 
        });
    } catch (error) {
        logger.error(error, 'Error in createSSE');
        res.write(
            `data: ${JSON.stringify({
                error: 'Terjadi kesalahan internal. Silakan coba lagi.',
            })}\n\n`,
        );
        cleanup();
    }
};

export const getSessionStatus: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId)!;
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }
        res.status(200).json({ status: getInstanceStatus(session), session });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getSessions: RequestHandler = async (req, res) => {
    try {
        const pkId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;

        const sessions = await prisma.session.findMany({
            where: {
                device: {
                    userId: privilegeId !== Number(process.env.SUPER_ADMIN_ID) ? pkId : undefined,
                },
                id: { contains: 'config' },
            },
            select: {
                sessionId: true,
                device: { select: { id: true, phone: true, status: true } },
            },
        });

        res.status(200).json(sessions);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getSessionsByDeviceApiKey: RequestHandler = async (req, res) => {
    try {
        const deviceApiKey = req.params.deviceApiKey;

        const existingDevice = await prisma.device.findUnique({
            where: {
                apiKey: deviceApiKey,
            },
        });

        if (!existingDevice) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const sessions = await prisma.session.findMany({
            where: {
                deviceId: existingDevice.pkId,
                id: { contains: 'config' },
            },
            select: {
                sessionId: true,
                data: true,
            },
        });

        if (!sessions) {
            return res.status(404).json({ message: 'Session not found' });
        }

        res.status(200).json(sessions);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

//to do: get session logs

export const deleteSession: RequestHandler = async (req, res) => {
    await deleteInstance(req.params.sessionId);

    if (!isUUID(req.params.sessionId)) {
        return res.status(400).json({ message: 'Invalid sessionId' });
    }

    res.status(200).json({ message: 'Session deleted' });
};

export const getSessionProfile: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.params.deviceId;

        if (!isUUID(req.params.deviceId)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }

        const device = await prisma.device.findUnique({
            where: { id: deviceId },
            select: {
                name: true,
                phone: true,
                sessions: { where: { id: { contains: 'config' } }, select: { sessionId: true } },
            },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const sessionId = device.sessions[0].sessionId;

        if (!sessionId) {
            return res.status(404).json({ message: 'Session not found' });
        }

        const jid = getJid(device.phone!);
        const session = getInstance(sessionId)!;
        const businessProfile = await session.getBusinessProfile(jid);
        const fetchStatusResults = await session.fetchStatus(jid);
        const statusInfo = Array.isArray(fetchStatusResults)
            ? fetchStatusResults[0]
            : fetchStatusResults;
        const user = await session.user;

        res.status(200).json({
            device,
            profileName: user?.name,
            presence: 'available',
            status: statusInfo?.status,
            address: businessProfile?.address,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateSessionProfile: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.params.deviceId;

        if (!isUUID(req.params.deviceId)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }
        const device = await prisma.device.findUnique({
            where: { id: deviceId },
            select: {
                sessions: { where: { id: { contains: 'config' } }, select: { sessionId: true } },
            },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const sessionId = device.sessions[0].sessionId;

        if (!sessionId) {
            return res.status(404).json({ message: 'Session not found' });
        }

        const session = getInstance(sessionId)!;
        const { profileName, presence, status } = req.body;

        session.updateProfileName(profileName);
        session.sendPresenceUpdate(presence);
        session.updateProfileStatus(status);

        res.status(200).json({ message: 'Session profile updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

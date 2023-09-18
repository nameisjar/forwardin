import makeWASocket, { Browsers, useMultiFileAuthState } from '@whiskeysockets/baileys';
import prisma from './utils/db';

export async function connectToWhatsApp(sessionId: string, deviceId: number) {
    // use sessionId
    // const { state, saveCreds } = await useSession(sessionId);

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        printQRInTerminal: true,
        browser: Browsers.ubuntu('Chrome'),
        auth: state,
    });

    sock.ev.on('creds.update', saveCreds);
    // sock.ev.on('connection.update', (update) => {
    //     const { connection, lastDisconnect } = update
    //     if(connection === 'close') {
    //         const shouldReconnect = (lastDisconnect.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
    //         console.log('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect)
    //         reconnect if not logged out
    //         if(shouldReconnect) {
    //             connectToWhatsApp()
    //         }
    //     } else if(connection === 'open') {
    //         console.log('opened connection')
    //     }
    // })
    sock.ev.on('messages.upsert', async (m) => {
        console.log(JSON.stringify(m, undefined, 2));

        console.log('replying to', m.messages[0].key.remoteJid);
        await sock.sendMessage(m.messages[0].key.remoteJid!, { text: 'Hello there!' });
    });

    await prisma.session.upsert({
        create: {
            sessionId,
            data: JSON.stringify({}),
            deviceId,
        },
        update: {},
        where: { pkId: 1 },
    });
}

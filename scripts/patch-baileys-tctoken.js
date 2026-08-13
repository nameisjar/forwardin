const fs = require('fs');
const path = require('path');

const TARGET_PATH = path.join(
    __dirname,
    '..',
    'node_modules',
    '@whiskeysockets',
    'baileys',
    'lib',
    'Socket',
    'messages-recv.js',
);

const PATCH_MARKER = 'AUTOSENDER_TCTOKEN_STORAGE_FIX';

const VULNERABLE_BLOCK = `        const from = jidNormalizedUser(node.attrs.from);
        // WA Web uses: senderLid ?? toLid(from) for the storage key
        // The sender_lid attribute provides the LID directly when available
        const senderLid = node.attrs.sender_lid && isLidUser(jidNormalizedUser(node.attrs.sender_lid))
            ? jidNormalizedUser(node.attrs.sender_lid)
            : undefined;
        const fallbackJid = senderLid ?? (await resolveTcTokenJid(from, getLIDForPN));
        logger.debug({ from, storageJid: fallbackJid }, 'processing privacy token notification');`;

const PATCHED_BLOCK = `        // ${PATCH_MARKER}: prefer the canonical peer derived from "from".
        // Some rc14 notifications expose our own LID in sender_lid; storing the
        // peer token there makes every later target lookup miss and causes 463.
        const from = jidNormalizedUser(node.attrs.from);
        const resolvedFrom = await resolveTcTokenJid(from, getLIDForPN);
        const ownLid = authState.creds.me?.lid
            ? jidNormalizedUser(authState.creds.me.lid)
            : undefined;
        const senderLid = node.attrs.sender_lid && isLidUser(jidNormalizedUser(node.attrs.sender_lid))
            ? jidNormalizedUser(node.attrs.sender_lid)
            : undefined;
        let fallbackJid = isLidUser(resolvedFrom) ? resolvedFrom : undefined;
        let senderLidAccepted = false;
        if (!fallbackJid && senderLid && (!ownLid || !areJidsSameUser(senderLid, ownLid))) {
            const senderPn = await signalRepository.lidMapping.getPNForLID(senderLid).catch(() => null);
            if (senderPn && areJidsSameUser(jidNormalizedUser(senderPn), from)) {
                fallbackJid = senderLid;
                senderLidAccepted = true;
            }
        }
        fallbackJid ??= resolvedFrom || from;
        logger.debug({
            fromAddressing: isLidUser(from) ? 'lid' : 'pn',
            storageAddressing: isLidUser(fallbackJid) ? 'lid' : 'pn',
            senderLidAccepted
        }, 'processing privacy token notification');`;

function transformMessagesRecvSource(source) {
    if (source.includes(PATCH_MARKER)) {
        return { source, changed: false };
    }
    if (!source.includes(VULNERABLE_BLOCK)) {
        throw new Error(
            'Baileys tctoken handler does not match the pinned rc14 source. ' +
            'Refusing to build without reviewing the privacy-token storage logic.',
        );
    }
    return {
        source: source.replace(VULNERABLE_BLOCK, PATCHED_BLOCK),
        changed: true,
    };
}

function patchBaileysTcTokenHandler(targetPath = TARGET_PATH) {
    if (!fs.existsSync(targetPath)) {
        throw new Error(`Baileys messages-recv.js not found: ${targetPath}`);
    }

    const original = fs.readFileSync(targetPath, 'utf8');
    const transformed = transformMessagesRecvSource(original);
    if (transformed.changed) {
        fs.writeFileSync(targetPath, transformed.source, 'utf8');
        console.log('Applied Baileys rc14 trusted-contact token storage fix.');
    } else {
        console.log('Baileys trusted-contact token storage fix already applied.');
    }
    return transformed.changed;
}

if (require.main === module) {
    try {
        patchBaileysTcTokenHandler();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

module.exports = {
    PATCH_MARKER,
    VULNERABLE_BLOCK,
    PATCHED_BLOCK,
    transformMessagesRecvSource,
    patchBaileysTcTokenHandler,
};

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
    'messages-send.js',
);

const PATCH_MARKER = 'AUTOSENDER_POLL_VOTE_DECRYPT_FAIL_FIX';

const VULNERABLE_BLOCK = `            if (normalizeMessageContent(message)?.pinInChatMessage || normalizeMessageContent(message)?.reactionMessage) {
                extraAttrs['decrypt-fail'] = 'hide'; // todo: expand for reactions and other types
            }`;

const PATCHED_BLOCK = `            // ${PATCH_MARKER}: encrypted poll votes require the same
            // decrypt-fail behavior as encrypted reactions. Current WhatsApp
            // servers validate this flag and may otherwise reject or hide the
            // vote update.
            if (normalizeMessageContent(message)?.pinInChatMessage ||
                normalizeMessageContent(message)?.reactionMessage ||
                normalizeMessageContent(message)?.pollUpdateMessage) {
                extraAttrs['decrypt-fail'] = 'hide';
            }`;

function transformMessagesSendSource(source) {
    if (source.includes(PATCH_MARKER)) {
        return { source, changed: false };
    }
    if (!source.includes(VULNERABLE_BLOCK)) {
        throw new Error(
            'Baileys poll-vote sender does not match the pinned rc14 source. ' +
            'Refusing to build without reviewing the encrypted-message attributes.',
        );
    }
    return {
        source: source.replace(VULNERABLE_BLOCK, PATCHED_BLOCK),
        changed: true,
    };
}

function patchBaileysPollVoteSender(targetPath = TARGET_PATH) {
    if (!fs.existsSync(targetPath)) {
        throw new Error(`Baileys messages-send.js not found: ${targetPath}`);
    }

    const original = fs.readFileSync(targetPath, 'utf8');
    const transformed = transformMessagesSendSource(original);
    if (transformed.changed) {
        fs.writeFileSync(targetPath, transformed.source, 'utf8');
        console.log('Applied Baileys rc14 encrypted poll-vote sender fix.');
    } else {
        console.log('Baileys encrypted poll-vote sender fix already applied.');
    }
    return transformed.changed;
}

if (require.main === module) {
    try {
        patchBaileysPollVoteSender();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

module.exports = {
    PATCH_MARKER,
    VULNERABLE_BLOCK,
    PATCHED_BLOCK,
    transformMessagesSendSource,
    patchBaileysPollVoteSender,
};

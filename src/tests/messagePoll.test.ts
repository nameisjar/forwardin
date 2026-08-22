import { expect } from 'chai';
import type { proto } from '@whiskeysockets/baileys';
import { decryptPollVote } from '@whiskeysockets/baileys';
import {
    createInitialMessagePollState,
    encryptMessagePollVote,
    extractMessagePollDefinition,
    messagePollCreationKey,
    messagePollCreatorJid,
    messagePollVoterJid,
    messagePollPreview,
    normalizeOutgoingMessagePoll,
} from '../services/messagePoll';

describe('WhatsApp poll parsing', () => {
    it('extracts a regular poll definition and stable option ids', () => {
        const definition = extractMessagePollDefinition({
            pollCreationMessageV3: {
                name: 'Pilih jadwal kelas',
                selectableOptionsCount: 1,
                options: [
                    { optionName: 'Pagi' },
                    { optionName: 'Malam' },
                ],
            },
        } as proto.IMessage);

        expect(definition?.question).to.equal('Pilih jadwal kelas');
        expect(definition?.options.map(option => option.name)).to.deep.equal([
            'Pagi',
            'Malam',
        ]);
        expect(definition?.options[0].id).to.not.equal(definition?.options[1].id);
        expect(messagePollPreview(definition)).to.equal('📊 Polling: Pilih jadwal kelas');
    });

    it('unwraps the future-proof V4 poll envelope', () => {
        const definition = extractMessagePollDefinition({
            pollCreationMessageV4: {
                message: {
                    pollCreationMessageV3: {
                        name: 'Pilih materi',
                        options: [{ optionName: 'Python' }, { optionName: 'Web' }],
                    },
                },
            },
        } as proto.IMessage);

        expect(definition?.question).to.equal('Pilih materi');
        expect(definition?.selectableOptionsCount).to.equal(1);
    });

    it('validates an outgoing multiple-answer poll', () => {
        const poll = normalizeOutgoingMessagePoll({
            poll: {
                name: 'Pilih materi',
                values: ['Python', 'Web'],
                selectableCount: 2,
            },
        });

        expect(poll?.content.poll).to.deep.equal({
            name: 'Pilih materi',
            values: ['Python', 'Web'],
            selectableCount: 2,
        });
        const initialState = createInitialMessagePollState(poll!.definition);
        expect(initialState.totalVotes).to.equal(0);
        expect(initialState.options.map(option => option.voteCount)).to.deep.equal([0, 0]);
    });

    it('rejects duplicate outgoing options', () => {
        expect(() => normalizeOutgoingMessagePoll({
            poll: {
                name: 'Pilih materi',
                values: ['Python', ' python '],
                selectableCount: 1,
            },
        })).to.throw('Pilihan polling tidak boleh sama');
    });

    it('encrypts a vote that WhatsApp poll decryption can read', () => {
        const pollEncKey = Buffer.alloc(32, 7);
        const context = {
            pollCreatorJid: '777777777777777@lid',
            pollMsgId: 'POLL-MESSAGE-ID',
            voterJid: '628222222222@s.whatsapp.net',
        };
        const selectedOptionIds = [Buffer.alloc(32, 3).toString('base64')];
        const encrypted = encryptMessagePollVote({
            pollMessageId: context.pollMsgId,
            pollCreatorJid: context.pollCreatorJid,
            pollSecret: pollEncKey,
            voterJid: context.voterJid,
            selectedOptionIds,
        });
        const decrypted = decryptPollVote(encrypted, {
            ...context,
            pollEncKey,
        });

        expect(decrypted.selectedOptions?.map(value => Buffer.from(value).toString('base64')))
            .to.deep.equal(selectedOptionIds);
    });

    it('uses the connected account LID for an outgoing poll creator', () => {
        expect(messagePollCreatorJid({
            key: { id: 'POLL-ID', remoteJid: '628222222222@s.whatsapp.net', fromMe: true },
            ownJid: '628111111111:12@s.whatsapp.net',
            ownLid: '777777777777777:12@lid',
        })).to.equal('777777777777777@lid');
    });

    it('prefers the primary participant LID over its PN alternative', () => {
        expect(messagePollCreatorJid({
            key: {
                id: 'POLL-ID',
                remoteJid: '120363000000000000@g.us',
                fromMe: false,
                participant: '888888888888888:7@lid',
                participantAlt: '628333333333:7@s.whatsapp.net',
            },
        })).to.equal('888888888888888@lid');
    });

    it('uses the own LID when voting in a LID-addressed group poll', () => {
        expect(messagePollVoterJid({
            conversationJid: '120363000000000000@g.us',
            pollCreatorJid: '888888888888888@lid',
            ownPnJid: '628111111111@s.whatsapp.net',
            ownLidJid: '777777777777777@lid',
        })).to.equal('777777777777777@lid');
    });

    it('includes the poll creator participant in an outgoing group target key', () => {
        expect(messagePollCreationKey({
            conversationJid: '120363000000000000@g.us',
            targetMessageId: 'POLL-ID',
            targetFromMe: true,
            pollCreatorJid: '777777777777777@lid',
        })).to.deep.equal({
            remoteJid: '120363000000000000@g.us',
            id: 'POLL-ID',
            fromMe: true,
            participant: '777777777777777@lid',
        });
    });
});

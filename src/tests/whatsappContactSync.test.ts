import { expect } from 'chai';
import {
    buildWhatsAppContactMutation,
    syncContactToWhatsApp,
} from '../services/whatsappContactSync';

describe('WhatsApp encrypted contact sync', () => {
    it('builds a WhatsApp-only contact mutation without phone address-book sync', () => {
        const mutation = buildWhatsAppContactMutation({
            phone: '+62 812-3456-7890',
            firstName: '  Asisten ',
            lastName: ' Tutor  ',
        });

        expect(mutation).to.deep.equal({
            jid: '6281234567890@s.whatsapp.net',
            contact: {
                firstName: 'Asisten',
                fullName: 'Asisten Tutor',
                saveOnPrimaryAddressbook: false,
            },
        });
    });

    it('rejects an invalid contact mutation', () => {
        expect(buildWhatsAppContactMutation({ phone: '', firstName: '', lastName: '' })).to.equal(
            null,
        );
    });

    it('reports device_offline when no connected WhatsApp instance exists', async () => {
        const result = await syncContactToWhatsApp({
            devicePkId: Number.MAX_SAFE_INTEGER,
            phone: '6281234567890',
            firstName: 'Asisten',
            lastName: 'Tutor',
        });

        expect(result).to.deep.equal({
            requested: true,
            synced: false,
            status: 'device_offline',
        });
    });
});

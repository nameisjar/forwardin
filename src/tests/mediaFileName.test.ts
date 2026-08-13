import { expect } from 'chai';
import { resolveMediaFileName, sanitizeMediaFileName } from '../utils/mediaFileName';

describe('scheduled media filename safety', () => {
    it('preserves a safe original filename for WhatsApp', () => {
        expect(sanitizeMediaFileName('Reminder Extra Class.pdf')).to.equal(
            'Reminder Extra Class.pdf',
        );
    });

    it('removes directories and unsafe filename characters', () => {
        expect(sanitizeMediaFileName('../folder\\Laporan: Agustus?.pdf')).to.equal(
            'Laporan_ Agustus_.pdf',
        );
    });

    it('uses only the basename for legacy Windows media paths', () => {
        expect(
            resolveMediaFileName(null, 'media\\Ddevice-id\\1786674321-72819382.pdf'),
        ).to.equal('1786674321-72819382.pdf');
    });
});

import { expect } from 'chai';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { persistGeneratedMediaBuffer } from '../services/generatedMediaStorage';

describe('Generated media storage', () => {
    it('persists a generated PDF under the device media directory', async () => {
        const baseDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'autosender-media-'));
        try {
            const content = Buffer.from('%PDF-1.4\nselectable text');
            const storedPath = await persistGeneratedMediaBuffer(
                'device/test',
                content,
                'Feedback Siswa.pdf',
                baseDirectory,
            );

            expect(storedPath).to.match(
                /^media\/Ddevice-test\/generated\/.+\.pdf$/,
            );
            const saved = await fs.readFile(path.resolve(baseDirectory, storedPath));
            expect(saved.equals(content)).to.equal(true);
        } finally {
            await fs.rm(baseDirectory, { recursive: true, force: true });
        }
    });

    it('rejects an empty generated document', async () => {
        let error: unknown;
        try {
            await persistGeneratedMediaBuffer('device', Buffer.alloc(0), 'empty.pdf');
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal('Generated media buffer is empty');
    });
});

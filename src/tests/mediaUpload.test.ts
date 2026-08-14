import { expect } from 'chai';
import { getMediaUploadErrorMessage, MAX_MEDIA_FILE_SIZE } from '../config/multer';

describe('media upload policy', () => {
    it('keeps the backend limit at 25 MB', () => {
        expect(MAX_MEDIA_FILE_SIZE).to.equal(25 * 1024 * 1024);
    });

    it('returns a useful message for oversized uploads', () => {
        expect(getMediaUploadErrorMessage({ code: 'LIMIT_FILE_SIZE' })).to.equal(
            'Ukuran file terlalu besar. Maksimal 25 MB',
        );
    });

    it('preserves the detailed file-filter rejection reason', () => {
        expect(getMediaUploadErrorMessage(new Error('File type .exe is not allowed'))).to.equal(
            'File type .exe is not allowed',
        );
    });
});

import { expect } from 'chai';
import path from 'path';
import { resolveSafeMediaFile } from '../services/mediaCleanup';

describe('Media cleanup path safety', () => {
    it('accepts files contained by the backend media directory', () => {
        expect(resolveSafeMediaFile('media/D1/example.jpg')).to.equal(
            path.resolve(process.cwd(), 'media', 'D1', 'example.jpg'),
        );
    });

    it('rejects paths outside the backend media directory', () => {
        expect(resolveSafeMediaFile('../example.jpg')).to.equal(null);
        expect(resolveSafeMediaFile('media/../example.jpg')).to.equal(null);
        expect(resolveSafeMediaFile(path.resolve(process.cwd(), 'src', 'index.ts'))).to.equal(null);
    });

    it('rejects inline and remote media references', () => {
        expect(resolveSafeMediaFile('data:image/png;base64,AAAA')).to.equal(null);
        expect(resolveSafeMediaFile('https://example.com/image.jpg')).to.equal(null);
    });
});

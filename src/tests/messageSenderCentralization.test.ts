import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

function collectTypeScriptFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectTypeScriptFiles(target);
        return entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
    });
}

describe('Outgoing send centralization', () => {
    it('keeps direct Baileys sendMessage calls inside messageSender only', () => {
        const sourceRoot = path.resolve(process.cwd(), 'src');
        const allowedFile = path.resolve(sourceRoot, 'services', 'messageSender.ts');
        const violations = collectTypeScriptFiles(sourceRoot)
            .filter(file => !file.includes(`${path.sep}tests${path.sep}`))
            .filter(file => path.resolve(file) !== allowedFile)
            .filter(file => /\.sendMessage\s*\(/.test(fs.readFileSync(file, 'utf8')))
            .map(file => path.relative(sourceRoot, file));

        expect(violations).to.deep.equal([]);
    });
});

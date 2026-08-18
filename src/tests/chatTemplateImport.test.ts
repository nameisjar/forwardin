import { expect } from 'chai';
import { planChatTemplateImport } from '../utils/chatTemplateImport';

const existing = [
    { pkId: 1, id: 'template-a', title: 'Template A', message: 'Pesan A' },
    { pkId: 2, id: 'template-b', title: 'Template B', message: 'Pesan B' },
];

describe('chat template import planner', () => {
    it('memisahkan template baru dan pembaruan milik user', () => {
        const plan = planChatTemplateImport([
            { rowNumber: 2, id: 'template-a', title: 'Template A Baru', message: 'Halo {{siswa}}' },
            { rowNumber: 3, id: '', title: 'Template C', message: 'Pesan C' },
        ], existing);

        expect(plan.errors).to.deep.equal([]);
        expect(plan.summary).to.deep.equal({ total: 2, create: 1, update: 1, unchanged: 0 });
        expect(plan.rows[0]).to.include({ action: 'update', pkId: 1 });
        expect(plan.rows[1]).to.include({ action: 'create' });
    });

    it('menolak ID template yang bukan milik user', () => {
        const plan = planChatTemplateImport([
            { id: 'template-user-lain', title: 'Template Lain', message: 'Pesan' },
        ], existing);

        expect(plan.errors.map((error) => error.message)).to.include(
            'Template ID tidak ditemukan pada akun ini',
        );
    });

    it('menolak judul akhir yang duplikat dalam akun yang sama', () => {
        const plan = planChatTemplateImport([
            { id: '', title: 'Template A', message: 'Pesan baru' },
        ], existing);

        expect(plan.errors.map((error) => error.message)).to.include(
            'Judul template sudah digunakan pada akun ini',
        );
    });

    it('mengizinkan pertukaran judul antara dua template sendiri', () => {
        const plan = planChatTemplateImport([
            { id: 'template-a', title: 'Template B', message: 'Pesan A' },
            { id: 'template-b', title: 'Template A', message: 'Pesan B' },
        ], existing);

        expect(plan.errors).to.deep.equal([]);
        expect(plan.summary.update).to.equal(2);
    });

    it('tidak menulis ulang template yang tidak berubah', () => {
        const plan = planChatTemplateImport([
            { id: 'template-a', title: 'Template A', message: 'Pesan A' },
        ], existing);

        expect(plan.errors).to.deep.equal([]);
        expect(plan.rows[0].action).to.equal('unchanged');
        expect(plan.summary.unchanged).to.equal(1);
        expect(plan.summary.update).to.equal(0);
    });
});

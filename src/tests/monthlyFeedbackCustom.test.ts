import { expect } from 'chai';
import { normalizeCustomFeedbackStudent } from '../controllers/monthlyFeedbackCustom';

const validStudent = {
    studentName: 'Raka Pratama',
    courseName: 'Python Start_2_IND',
    month: 5,
    youtubeLink: 'https://youtu.be/contoh',
    referralLink: 'https://algonova.id/invite/contoh',
    rating: 5,
    reportBy: 'Niko Muhamad Fajar',
};

describe('Custom monthly feedback validation', () => {
    it('accepts feedback without tutor comments', () => {
        const student = normalizeCustomFeedbackStudent(
            { ...validStudent, tutorComment: '' },
            0,
        );

        expect(student.tutorComment).to.equal('');
    });

    it('continues to require course, month, and valid links', () => {
        expect(() =>
            normalizeCustomFeedbackStudent(
                { ...validStudent, courseName: '', youtubeLink: 'bukan-url' },
                0,
            ),
        ).to.throw('Baris 1 tidak valid: course, link YouTube');
    });
});

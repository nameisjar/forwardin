import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';

async function seedReminderPythonPro1(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseReminder.createMany({
            data: [
                {
                    courseName: 'python pro 1',
                    lesson: 1,
                    message:
                        "🗓 **Tanggal**: Jum'at, 25 Oktober 2024\n⏰ **Waktu**: 20.00 - 21.30 WIB\n📖 **Pertemuan ke**: 1\n📝 **Topik**: M1L1. Konsep Dasar Pemrograman Python\n\n**Rekaman Kelas dan Link PPT**: [Google Sheets](https://docs.google.com/spreadsheets/d/1c1JAezfG4JCJih4wH5EdrWVFldyoKReJabPUNtUzlLY/edit?gid=0#gid=0)\n\nHalo, Parents! 👋\n\nDengan senang hati saya menyambut Anda di kursus Python Pro. Saya berharap Anda dan adik-adik menikmati perjalanan belajar coding bersama saya! 🤩\n\nPada pelajaran pertama ini, adik-adik menunjukkan minat yang besar dan berpartisipasi aktif dalam diskusi. Kami membahas konsep-konsep dasar pemrograman yang sangat penting untuk studi lebih lanjut. Saya sangat terkesan melihat betapa banyak konsep yang sudah mereka pahami, dan mereka siap untuk mempelajari materi dengan lebih mendalam.\n\nBerikut pencapaian yang telah mereka raih:\n1️⃣ Mengulas konsep dasar pemrograman: bahasa pemrograman, algoritma, program, dan fungsi.\n2️⃣ Berdiskusi tentang bagaimana Python bisa digunakan dalam kehidupan sehari-hari.\n3️⃣ Mempraktikkan fungsi `print()` untuk mencetak data dan melihat contoh penerapannya.\n4️⃣ Menerapkan aturan-aturan dasar bahasa pemrograman Python di lingkungan programming online.\n5️⃣ Dikenalkan dengan platform Algorithmics dan menyelesaikan tugas orientasi pertama untuk perusahaan.\n\nSaya berharap kelas-kelas mendatang akan sama produktif dan menariknya. Jika ada pertanyaan, jangan ragu untuk bertanya di obrolan atau secara pribadi kepada saya. Saya selalu siap membantu dan mendukung adik-adik Anda dalam proses belajar.\n\nSampai jumpa di kelas berikutnya! See you! 🙋",
                },
                {
                    courseName: 'python pro 1',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Reminder Python Pro 1 seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}
async function seedReminderPythonStart1(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseReminder.createMany({
            data: [
                {
                    courseName: 'python start 1',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'python start 1',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Reminder Python Start 1 seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}
async function seedReminderVisualProgramming(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseReminder.createMany({
            data: [
                {
                    courseName: 'visual programming',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'visual programming',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Reminder Visual Programming seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedReminderCodingKnight(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseReminder.createMany({
            data: [
                {
                    courseName: 'coding knight',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'coding knight',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Reminder Coding Knight seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedReminderPythonStart2(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseReminder.createMany({
            data: [
                {
                    courseName: 'python start 2',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'python start 2',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Reminder Python Start 2 seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedFeedbackPythonPro1(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseFeedback.createMany({
            data: [
                {
                    courseName: 'python pro 1',
                    lesson: 1,
                    message:
                        'Halo Ayah/Bunda! 👋\n\nSelamat datang di kursus Python Pro! Semoga Ayah/Bunda dan adik-adik menikmati perjalanan belajar coding bareng saya ya! 🤩\n\nDi pelajaran pertama ini, adik-adik terlihat sangat antusias dan aktif banget dalam diskusi. Kami membahas konsep-konsep dasar pemrograman yang jadi pondasi penting untuk pelajaran selanjutnya. Saya juga kagum banget dengan pemahaman mereka sejauh ini—mereka siap banget buat mendalami materi lebih jauh!\n\nIni dia beberapa pencapaian mereka:\n\n1️⃣ Mengenal konsep dasar pemrograman seperti bahasa pemrograman, algoritma, program, dan fungsi.\n\n2️⃣ Diskusi seru soal gimana Python bisa dipakai dalam kehidupan sehari-hari.\n\n3️⃣ Belajar dan mencoba fungsi `print()` buat mencetak data.\n\n4️⃣ Memahami aturan dasar pemrograman Python di lingkungan coding online.\n\n5️⃣ Mengenal platform Algorithmics dan menyelesaikan tugas orientasi pertama.\n\nSemoga kelas berikutnya tetap produktif dan menyenangkan! Kalau ada pertanyaan, jangan ragu buat tanya di grup atau langsung ke saya, ya. Saya selalu siap bantu.\n\nSampai jumpa di kelas berikutnya! See you! 🙋🚀',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Feedback Python Pro 1 seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedFeedbackPythonStart1(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseFeedback.createMany({
            data: [
                {
                    courseName: 'python start 1',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'python start 1',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Feedback Python Start 1 seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedFeedbackPythonStart2(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseFeedback.createMany({
            data: [
                {
                    courseName: 'python start 2',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'python start 2',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Feedback Python Start 2 seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedFeedbackVisualProgramming(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseFeedback.createMany({
            data: [
                {
                    courseName: 'visual programming',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'visual programming',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Feedback Visual Programming seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedFeedbackCodingKnight(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseFeedback.createMany({
            data: [
                {
                    courseName: 'coding knight',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'coding knight',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Feedback Coding Knight seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

export {
    seedReminderPythonPro1,
    seedReminderPythonStart1,
    seedReminderVisualProgramming,
    seedReminderCodingKnight,
    seedReminderPythonStart2,
    seedFeedbackPythonPro1,
    seedFeedbackPythonStart1,
    seedFeedbackPythonStart2,
    seedFeedbackVisualProgramming,
    seedFeedbackCodingKnight,
};

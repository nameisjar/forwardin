export const MAX_CHAT_TEMPLATE_IMPORT_ROWS = 500;
export const MAX_CHAT_TEMPLATE_TITLE_LENGTH = 128;
export const MAX_CHAT_TEMPLATE_MESSAGE_LENGTH = 10_000;

export type ExistingChatTemplate = {
    pkId: number;
    id: string;
    title: string;
    message: string;
};

export type PlannedChatTemplateRow = {
    rowNumber: number;
    id: string;
    title: string;
    message: string;
    action: 'create' | 'update' | 'unchanged';
    pkId?: number;
};

export type ChatTemplateImportError = {
    rowNumber: number;
    message: string;
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const titleKey = (value: string) => value.toLocaleLowerCase('id-ID');

const addError = (
    errors: ChatTemplateImportError[],
    errorKeys: Set<string>,
    rowNumber: number,
    message: string,
) => {
    const key = `${rowNumber}:${message}`;
    if (errorKeys.has(key)) return;
    errorKeys.add(key);
    errors.push({ rowNumber, message });
};

export function planChatTemplateImport(
    input: unknown,
    existingTemplates: ExistingChatTemplate[],
) {
    const errors: ChatTemplateImportError[] = [];
    const errorKeys = new Set<string>();

    if (!Array.isArray(input) || input.length === 0) {
        return {
            rows: [] as PlannedChatTemplateRow[],
            errors: [{ rowNumber: 0, message: 'File tidak berisi data template' }],
            summary: { total: 0, create: 0, update: 0, unchanged: 0 },
        };
    }
    if (input.length > MAX_CHAT_TEMPLATE_IMPORT_ROWS) {
        return {
            rows: [] as PlannedChatTemplateRow[],
            errors: [{
                rowNumber: 0,
                message: `Maksimal ${MAX_CHAT_TEMPLATE_IMPORT_ROWS} template dalam satu kali import`,
            }],
            summary: { total: input.length, create: 0, update: 0, unchanged: 0 },
        };
    }

    const existingById = new Map(existingTemplates.map((template) => [template.id, template]));
    const seenIds = new Map<string, number>();
    const rows: PlannedChatTemplateRow[] = [];

    input.forEach((raw, index) => {
        const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const requestedRowNumber = Number(source.rowNumber);
        const rowNumber = Number.isInteger(requestedRowNumber) && requestedRowNumber >= 2
            ? requestedRowNumber
            : index + 2;
        const id = text(source.id);
        const title = text(source.title);
        const message = text(source.message);

        if (!title) addError(errors, errorKeys, rowNumber, 'Judul template wajib diisi');
        if (title.length > MAX_CHAT_TEMPLATE_TITLE_LENGTH) {
            addError(
                errors,
                errorKeys,
                rowNumber,
                `Judul template maksimal ${MAX_CHAT_TEMPLATE_TITLE_LENGTH} karakter`,
            );
        }
        if (!message) addError(errors, errorKeys, rowNumber, 'Isi pesan wajib diisi');
        if (message.length > MAX_CHAT_TEMPLATE_MESSAGE_LENGTH) {
            addError(
                errors,
                errorKeys,
                rowNumber,
                `Isi pesan maksimal ${MAX_CHAT_TEMPLATE_MESSAGE_LENGTH.toLocaleString('id-ID')} karakter`,
            );
        }

        let ownedTemplate: ExistingChatTemplate | undefined;
        if (id) {
            ownedTemplate = existingById.get(id);
            if (!ownedTemplate) {
                addError(errors, errorKeys, rowNumber, 'Template ID tidak ditemukan pada akun ini');
            }
            const previousRow = seenIds.get(id);
            if (previousRow) {
                addError(errors, errorKeys, previousRow, 'Template ID muncul lebih dari satu kali');
                addError(errors, errorKeys, rowNumber, 'Template ID muncul lebih dari satu kali');
            } else {
                seenIds.set(id, rowNumber);
            }
        }

        const action = !id
            ? 'create'
            : ownedTemplate && ownedTemplate.title === title && ownedTemplate.message === message
                ? 'unchanged'
                : 'update';
        rows.push({
            rowNumber,
            id,
            title,
            message,
            action,
            ...(ownedTemplate ? { pkId: ownedTemplate.pkId } : {}),
        });
    });

    // Validasi judul terhadap kondisi akhir koleksi user, termasuk template
    // yang tidak disertakan di file.
    const updatedById = new Map(rows.filter((row) => row.id).map((row) => [row.id, row]));
    const finalTitles: Array<{ title: string; rowNumber: number | null }> = existingTemplates.map(
        (template) => {
            const update = updatedById.get(template.id);
            return update
                ? { title: update.title, rowNumber: update.rowNumber }
                : { title: template.title, rowNumber: null };
        },
    );
    rows.filter((row) => !row.id).forEach((row) => {
        finalTitles.push({ title: row.title, rowNumber: row.rowNumber });
    });

    const titles = new Map<string, Array<{ rowNumber: number | null }>>();
    finalTitles.forEach((entry) => {
        if (!entry.title) return;
        const key = titleKey(entry.title);
        const entries = titles.get(key) || [];
        entries.push({ rowNumber: entry.rowNumber });
        titles.set(key, entries);
    });
    titles.forEach((entries) => {
        if (entries.length < 2) return;
        entries.forEach(({ rowNumber }) => {
            if (rowNumber !== null) {
                addError(errors, errorKeys, rowNumber, 'Judul template sudah digunakan pada akun ini');
            }
        });
    });

    errors.sort((a, b) => a.rowNumber - b.rowNumber);
    return {
        rows,
        errors,
        summary: {
            total: rows.length,
            create: rows.filter((row) => row.action === 'create').length,
            update: rows.filter((row) => row.action === 'update').length,
            unchanged: rows.filter((row) => row.action === 'unchanged').length,
        },
    };
}

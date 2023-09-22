export function generateSlug(input: string): string {
    const slug = input.toLowerCase().replace(/\s+/g, '-');
    const cleanedSlug = slug.replace(/[^a-z0-9-]/g, '');
    const finalSlug = cleanedSlug.replace(/^-+|-+$/g, '');

    return finalSlug;
}

import dotenv from 'dotenv';

const loaded = dotenv.config();
const parsed = loaded.parsed || {};
const referencePattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const expandValue = (value: string, resolving: Set<string>): string =>
    value.replace(referencePattern, (placeholder, referencedName: string) => {
        if (resolving.has(referencedName)) return placeholder;

        const referencedValue = process.env[referencedName] ?? parsed[referencedName];
        if (referencedValue === undefined) return placeholder;

        const nextResolving = new Set(resolving);
        nextResolving.add(referencedName);
        return expandValue(referencedValue, nextResolving);
    });

// dotenv intentionally does not expand ${VAR} references. Resolve values from
// this file before Prisma and the rest of the application read process.env.
for (const key of Object.keys(parsed)) {
    process.env[key] = expandValue(process.env[key] ?? parsed[key], new Set([key]));
}


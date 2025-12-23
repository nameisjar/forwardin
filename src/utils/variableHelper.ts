type TemplateVariables = {
    [key: string]: string | undefined;
};

// Variable aliases: maps user-friendly names to internal variable names
const VARIABLE_ALIASES: { [key: string]: string } = {
    siswa: 'firstName',    // {{siswa}} -> firstName
    nama: 'firstName',     // {{nama}} -> firstName
    student: 'firstName',  // {{student}} -> firstName
};

/**
 * Replace template variables in a string.
 * Supports two formats:
 * - {{$variableName}} - original format with dollar sign
 * - {{variableName}} - simplified format without dollar sign
 * 
 * Also supports aliases like {{siswa}} which maps to firstName
 */
export function replaceVariables(template: string, variables: TemplateVariables) {
    // Match both {{$varName}} and {{varName}} formats
    const regex = /\{\{\$?(\w+)\}\}/g;

    return template.replace(regex, (match, variableName) => {
        // Check if there's an alias for this variable name
        const resolvedName = VARIABLE_ALIASES[variableName.toLowerCase()] || variableName;
        const value = variables[resolvedName];
        return value !== undefined ? value : '';
    });
}

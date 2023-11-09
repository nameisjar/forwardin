type TemplateVariables = {
    [key: string]: string;
};

export function replaceVariables(template: string, variables: TemplateVariables) {
    const regex = /\{\{\$(\w+)\}\}/g;

    return template.replace(regex, (match, variableName) => {
        const value = variables[variableName];
        return value !== undefined ? value : match;
    });
}

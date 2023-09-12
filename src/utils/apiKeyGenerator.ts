import { v4 as uuidv4 } from 'uuid';

export function generateApiKey(): string {
    const apiKey: string = uuidv4();
    return apiKey;
}

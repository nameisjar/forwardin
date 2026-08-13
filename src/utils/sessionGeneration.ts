/**
 * Tracks the single active socket generation for every WhatsApp session.
 *
 * A monotonically increasing id is used instead of a per-session counter so a
 * delayed callback can never become current again after a session is cleared
 * and later recreated with the same id.
 */
export class SessionGenerationRegistry {
    private readonly activeGenerations = new Map<string, number>();
    private nextGeneration = 0;

    begin(sessionId: string): number {
        const generation = ++this.nextGeneration;
        this.activeGenerations.set(sessionId, generation);
        return generation;
    }

    isCurrent(sessionId: string, generation: number): boolean {
        return this.activeGenerations.get(sessionId) === generation;
    }

    clear(sessionId: string, generation: number): boolean {
        if (!this.isCurrent(sessionId, generation)) return false;
        this.activeGenerations.delete(sessionId);
        return true;
    }
}

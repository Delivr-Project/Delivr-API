export class ExpiringStore<T> {

    private readonly entries = new Map<string, { value: T; expiresAt: number }>();

    constructor(
        readonly ttlMs: number,
        private readonly maxEntries = 10_000
    ) {
        setInterval(() => this.purge(), ttlMs).unref();
    }

    set(key: string, value: T) {
        if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
            this.purge();
            if (this.entries.size >= this.maxEntries) {
                return null;
            }
        }

        const expiresAt = Date.now() + this.ttlMs;
        this.entries.set(key, { value, expiresAt });
        return expiresAt;
    }

    get(key: string) {
        const entry = this.entries.get(key);
        if (!entry) return null;

        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return null;
        }

        return entry.value;
    }

    take(key: string) {
        const value = this.get(key);
        this.entries.delete(key);
        return value;
    }

    delete(key: string) {
        this.entries.delete(key);
    }

    private purge() {
        const now = Date.now();
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) this.entries.delete(key);
        }
    }

}

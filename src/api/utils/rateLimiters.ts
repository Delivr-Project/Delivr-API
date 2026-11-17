interface Counter {
    count: number;
    resetAt: number;
}

function incrementCounter(counters: Map<string, Counter>, id: string, windowMs: number) {
    const now = Date.now();
    const counter = counters.get(id);

    if (!counter || counter.resetAt <= now) {
        counters.set(id, { count: 1, resetAt: now + windowMs });
        return 1;
    }

    counter.count += 1;
    return counter.count;
}

function purgeCounters(...maps: Map<string, Counter>[]) {
    const now = Date.now();
    for (const counters of maps) {
        for (const [id, counter] of counters) {
            if (counter.resetAt <= now) counters.delete(id);
        }
    }
}

export class RequestLimiter {

    private readonly perClient = new Map<string, Counter>();

    constructor(
        readonly windowMs: number,
        private readonly maxRequests: number
    ) {
        setInterval(() => purgeCounters(this.perClient), windowMs).unref();
    }

    get retryAfterSeconds() {
        return Math.ceil(this.windowMs / 1000);
    }

    hit(client: string | null) {
        if (client === null) return true;
        return incrementCounter(this.perClient, client, this.windowMs) <= this.maxRequests;
    }

}

// shared/utils/MemoryRedis.ts
// In-memory Redis fallback — used when Redis is unavailable.
// TTL expiry is properly implemented via setTimeout to ensure
// rate limits and session data actually expire.

export class MemoryRedis {
    private store = new Map<string, string>();
    private lists = new Map<string, string[]>();
    private sets  = new Map<string, Set<string>>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();

    private clearTimer(key: string): void {
        const existing = this.timers.get(key);
        if (existing) {
            clearTimeout(existing);
            this.timers.delete(key);
        }
    }

    private setTimer(key: string, seconds: number): void {
        this.clearTimer(key);
        const timer = setTimeout(() => {
            this.store.delete(key);
            this.lists.delete(key);
            this.timers.delete(key);
        }, seconds * 1000);
        // Allow Node.js to exit even if this timer is pending
        if (timer.unref) timer.unref();
        this.timers.set(key, timer);
    }

    async get(key: string): Promise<string | null> {
        return this.store.get(key) ?? null;
    }

    async set(key: string, value: string): Promise<string> {
        this.clearTimer(key);
        this.store.set(key, value);
        return 'OK';
    }

    async setex(key: string, seconds: number, value: string): Promise<string> {
        this.store.set(key, value);
        this.setTimer(key, seconds);
        return 'OK';
    }

    async del(key: string): Promise<number> {
        this.clearTimer(key);
        const hadStore = this.store.delete(key);
        const hadList  = this.lists.delete(key);
        return hadStore || hadList ? 1 : 0;
    }

    async incr(key: string): Promise<number> {
        const val = parseInt(this.store.get(key) ?? '0', 10);
        const newVal = val + 1;
        this.store.set(key, newVal.toString());
        return newVal;
    }

    async expire(key: string, seconds: number): Promise<number> {
        if (!this.store.has(key) && !this.lists.has(key)) return 0;
        this.setTimer(key, seconds);
        return 1;
    }

    async lpush(key: string, value: string): Promise<number> {
        if (!this.lists.has(key)) this.lists.set(key, []);
        const list = this.lists.get(key)!;
        list.unshift(value);
        return list.length;
    }

    async lrange(key: string, start: number, end: number): Promise<string[]> {
        const list = this.lists.get(key) ?? [];
        return end === -1 ? list.slice(start) : list.slice(start, end + 1);
    }

    async keys(pattern: string): Promise<string[]> {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        const allKeys = [...this.store.keys(), ...this.lists.keys(), ...this.sets.keys()];
        return [...new Set(allKeys)].filter(k => regex.test(k));
    }

    // ── Set operations (used by semantic response cache) ─────────────────────
    async sadd(key: string, ...members: string[]): Promise<number> {
        if (!this.sets.has(key)) this.sets.set(key, new Set());
        const set = this.sets.get(key)!;
        let added = 0;
        for (const m of members) {
            if (!set.has(m)) { set.add(m); added++; }
        }
        return added;
    }

    async srem(key: string, ...members: string[]): Promise<number> {
        const set = this.sets.get(key);
        if (!set) return 0;
        let removed = 0;
        for (const m of members) {
            if (set.delete(m)) removed++;
        }
        if (set.size === 0) this.sets.delete(key);
        return removed;
    }

    async smembers(key: string): Promise<string[]> {
        const set = this.sets.get(key);
        return set ? [...set] : [];
    }

    async scard(key: string): Promise<number> {
        return this.sets.get(key)?.size ?? 0;
    }
}

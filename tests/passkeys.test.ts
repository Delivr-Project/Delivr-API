import { describe, expect, test } from "bun:test";
import { RequestLimiter } from "../src/api/utils/rateLimiters";

describe("Rate limiters", () => {

    test("RequestLimiter limits known clients and skips unknown ones", () => {
        const limiter = new RequestLimiter(60_000, 2);

        expect(limiter.hit("203.0.113.1")).toBe(true);
        expect(limiter.hit("203.0.113.1")).toBe(true);
        expect(limiter.hit("203.0.113.1")).toBe(false);
        expect(limiter.hit("203.0.113.2")).toBe(true);
        expect(limiter.hit(null)).toBe(true);
    });
});

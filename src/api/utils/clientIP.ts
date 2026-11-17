import { isIP } from "node:net";
import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { ConfigHandler } from "../../utils/config";

/**
 * The client's IP address, or `null` when it cannot be determined.
 *
 * Sources:
 * - With `DLA_TRUST_PROXY`, only the last `X-Forwarded-For` entry — the address the trusted proxy
 *   saw. Earlier entries are sent by the client and can be forged. Without the header the result
 *   is `null`: the direct peer is the proxy, and its address would make every visitor one client.
 * - Otherwise a `clientIP` env binding (callers that run the app via
 *   `app.fetch(request, { clientIP })`), else the Bun server's socket address
 *   (`Bun.serve({ fetch: app.fetch })` passes the server as env).
 *
 * A loopback address yields `null` too: it is a reverse proxy on the same host (or a local tool),
 * never a remote client. IPv4-mapped IPv6 addresses (`::ffff:203.0.113.5`, what a dual-stack `::`
 * listener reports for IPv4) come back as plain IPv4; anything that is not an IP address is `null`.
 *
 * `app.request()` in tests passes no env, so it yields `null` unless a test provides one.
 */
export function getClientIP(c: Context): string | null {
    const ip =
        ConfigHandler.getConfig()?.DLA_TRUST_PROXY === true ? getForwardedAddress(c) : getPeerAddress(c);
    return ip === null || isLoopback(ip) ? null : ip;
}

/**
 * The identity a rate limiter should count a client address under: IPv4 as is, IPv6 as its /64
 * prefix (`2001:db8:0:1::/64`). A single IPv6 host usually controls a whole /64, so a per-address
 * limit would hand it ~2^64 fresh identities. Addresses in `::/64` (loopback, IPv4-compatible)
 * stay whole rather than collapsing into one shared bucket.
 */
export function getClientRateLimitKey(ip: string): string {
    if (isIP(ip) !== 6) return ip;

    const prefix = expandIPv6(ip.split("%")[0] ?? ip).slice(0, 4);
    if (prefix.every((group) => group === 0)) return ip;
    return `${prefix.map((group) => group.toString(16)).join(":")}::/64`;
}

function getForwardedAddress(c: Context): string | null {
    const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    return forwarded ? normalizeIP(forwarded) : null;
}

function getPeerAddress(c: Context): string | null {
    const bound = (c.env as { clientIP?: unknown } | undefined)?.clientIP;
    if (typeof bound === "string" && bound) return normalizeIP(bound);

    try {
        const address = getConnInfo(c).remote.address;
        return address ? normalizeIP(address) : null;
    } catch {
        return null;
    }
}

function normalizeIP(address: string): string | null {
    const ip = address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
    return isIP(ip) === 0 ? null : ip;
}

function isLoopback(ip: string): boolean {
    return ip === "::1" || (isIP(ip) === 4 && ip.startsWith("127."));
}

/** The eight 16-bit groups of a valid IPv6 address (an embedded IPv4 tail counts as two). */
function expandIPv6(ip: string): number[] {
    const toGroups = (part: string | undefined) =>
        part
            ? part.split(":").flatMap((group) => {
                    if (!group.includes(".")) return [Number.parseInt(group, 16)];
                    const [a = 0, b = 0, c = 0, d = 0] = group.split(".").map(Number);
                    return [(a << 8) | b, (c << 8) | d];
                })
            : [];

    const [head, tail] = ip.split("::");
    const headGroups = toGroups(head);
    if (tail === undefined) return headGroups;

    const tailGroups = toGroups(tail);
    const zeros = new Array<number>(8 - headGroups.length - tailGroups.length).fill(0);
    return [...headGroups, ...zeros, ...tailGroups];
}

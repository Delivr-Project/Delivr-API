import { promises as dns } from "node:dns";
import { Logger } from "../../../utils/logger";

/**
 * Resolves BIMI (Brand Indicators for Message Identification) DNS records for a
 * sender domain and exposes the brand logo URL that mail clients can render as a
 * sender profile picture.
 *
 * A BIMI record is a `TXT` record published at `<selector>._bimi.<domain>` whose
 * value is a `;`-delimited list of `tag=value` pairs, e.g.
 *
 * ```
 * v=BIMI1; l=https://example.com/logo.svg; a=https://example.com/vmc.pem
 * ```
 *
 * - `v` — version, always `BIMI1` (required, must be first).
 * - `l` — HTTPS URL of the brand logo (SVG Tiny Portable/Secure). May be empty.
 * - `a` — HTTPS URL of the Verified Mark Certificate (VMC). Optional.
 *
 * Only the record metadata (the URLs) is resolved here — the SVG bytes are never
 * fetched or stored server-side; the client loads the logo from `logoUrl`
 * directly, mirroring how Gravatar avatars are loaded.
 */
export class BimiService {

    /** Default BIMI selector used when a message does not specify one. */
    static readonly DEFAULT_SELECTOR = "default";

    /** How long a successful lookup is cached. */
    private static readonly POSITIVE_TTL_MS = 1000 * 60 * 60 * 12; // 12h
    /** How long a "no record" result is cached to avoid hammering DNS. */
    private static readonly NEGATIVE_TTL_MS = 1000 * 60 * 30; // 30m

    private static readonly cache = new Map<string, BimiService.CacheEntry>();

    /**
     * Resolve the BIMI record for a sender domain.
     *
     * @param domain The sender domain (e.g. `example.com`). The domain portion of
     *               an email address, obtained via `address.split('@').pop()`.
     * @param selector The BIMI selector; defaults to `default`.
     * @returns The parsed record, or `null` when the domain publishes no usable
     *          BIMI record (missing record, malformed value, or no logo URL).
     */
    static async resolve(domain: string, selector: string = BimiService.DEFAULT_SELECTOR): Promise<BimiService.Record | null> {

        const normalizedDomain = domain.trim().toLowerCase().replace(/\.$/, "");
        const normalizedSelector = (selector || BimiService.DEFAULT_SELECTOR).trim().toLowerCase();

        if (!BimiService.isValidDomain(normalizedDomain)) {
            return null;
        }

        const recordName = `${normalizedSelector}._bimi.${normalizedDomain}`;

        const cached = BimiService.cache.get(recordName);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }

        let value: BimiService.Record | null = null;
        let ttl = BimiService.NEGATIVE_TTL_MS;

        try {
            // resolveTxt returns an array of records, each split into string chunks
            // that must be concatenated back together.
            const records = await dns.resolveTxt(recordName);

            for (const chunks of records) {
                const raw = chunks.join("");
                const parsed = BimiService.parseRecord(raw, normalizedDomain, normalizedSelector);
                if (parsed) {
                    value = parsed;
                    ttl = BimiService.POSITIVE_TTL_MS;
                    break;
                }
            }
        } catch (e) {
            const code = (e as NodeJS.ErrnoException)?.code;
            // ENODATA / ENOTFOUND simply mean the domain has no BIMI record — that
            // is an expected, cacheable outcome rather than an error.
            if (code !== "ENODATA" && code !== "ENOTFOUND" && code !== "SERVFAIL") {
                Logger.warn(`BIMI lookup for ${recordName} failed`, e);
            }
            value = null;
        }

        BimiService.cache.set(recordName, { value, expiresAt: Date.now() + ttl });
        return value;
    }

    /**
     * Parse a raw BIMI TXT record value into a structured record. Returns `null`
     * for anything that is not a valid `BIMI1` record carrying an HTTPS logo URL.
     *
     * Exposed for unit testing.
     */
    static parseRecord(raw: string, domain: string, selector: string): BimiService.Record | null {

        const tags = new Map<string, string>();

        for (const part of raw.split(";")) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            const eq = trimmed.indexOf("=");
            if (eq === -1) continue;

            const key = trimmed.slice(0, eq).trim().toLowerCase();
            const val = trimmed.slice(eq + 1).trim();
            // First occurrence wins; ignore duplicate tags.
            if (!tags.has(key)) tags.set(key, val);
        }

        const version = tags.get("v");
        if (!version || version.toUpperCase() !== "BIMI1") {
            return null;
        }

        const logoUrl = BimiService.normalizeHttpsUrl(tags.get("l"));
        const authorityUrl = BimiService.normalizeHttpsUrl(tags.get("a"));

        // A record without a usable logo URL is not useful as a profile picture.
        if (!logoUrl) {
            return null;
        }

        return {
            domain,
            selector,
            version: "BIMI1",
            logoUrl,
            authorityUrl,
        };
    }

    /**
     * Validate and normalize a BIMI URL value. Per the BIMI spec the transport
     * MUST be HTTPS; anything else (empty, http, malformed) is rejected.
     */
    private static normalizeHttpsUrl(value: string | undefined): string | null {
        if (!value) return null;
        try {
            const url = new URL(value);
            if (url.protocol !== "https:") return null;
            return url.toString();
        } catch {
            return null;
        }
    }

    /** Lightweight sanity check to avoid issuing DNS queries for junk input. */
    private static isValidDomain(domain: string): boolean {
        if (!domain || domain.length > 253) return false;
        // Labels of letters/digits/hyphens separated by dots, at least one dot.
        return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain);
    }

    /** Clears the in-memory cache. Primarily useful for tests. */
    static clearCache(): void {
        BimiService.cache.clear();
    }
}

export namespace BimiService {

    export interface Record {
        /** The domain the record was resolved for. */
        domain: string;
        /** The BIMI selector used for the lookup. */
        selector: string;
        /** BIMI version tag — always `BIMI1`. */
        version: "BIMI1";
        /** HTTPS URL of the brand logo (SVG). */
        logoUrl: string;
        /** HTTPS URL of the Verified Mark Certificate, if published. */
        authorityUrl: string | null;
    }

    export interface CacheEntry {
        value: Record | null;
        expiresAt: number;
    }
}

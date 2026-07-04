import { z } from "zod";

export namespace BimiModel {

    /**
     * A resolved BIMI record for a sender domain.
     */
    export const Record = z.object({
        /** The domain the record was resolved for. */
        domain: z.string().describe("The sender domain the record was resolved for"),

        /** The BIMI selector used for the lookup. */
        selector: z.string().describe("The BIMI selector used for the lookup (default: \"default\")"),

        /** BIMI version tag — always `BIMI1`. */
        version: z.literal("BIMI1").describe("BIMI record version"),

        /** HTTPS URL of the brand logo (SVG Tiny PS). */
        logoUrl: z.string().url().describe("HTTPS URL of the brand logo (SVG), usable directly as an avatar source"),

        /** HTTPS URL of the Verified Mark Certificate, if published. */
        authorityUrl: z.string().url().nullable().describe("HTTPS URL of the Verified Mark Certificate (VMC), if published"),
    });

    export type Record = z.infer<typeof Record>;
}

export namespace BimiModel.GetByDomain {

    /**
     * Path parameters for the BIMI lookup endpoint.
     */
    export const Params = z.object({
        domain: z.string().min(1).max(253)
            .describe("The sender domain to look up, e.g. \"example.com\"")
    });

    export type Params = z.infer<typeof Params>;

    /**
     * Query parameters for the BIMI lookup endpoint.
     */
    export const Query = z.object({
        selector: z.string().min(1).max(63).default("default")
            .describe("The BIMI selector to query (from a message's BIMI-Selector header, if any)")
    });

    export type Query = z.infer<typeof Query>;

    /**
     * Response for a successful BIMI lookup.
     */
    export const Response = BimiModel.Record;

    export type Response = z.infer<typeof Response>;
}

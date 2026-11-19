import { z } from "zod";

export namespace ApiHelperModels {

    function fromQueryString(value: unknown): unknown {
        switch (value) {
            case "true": case "1": return true;
            case "false": case "0": return false;
            default: return value;
        }
    }

    /**
     * A boolean query parameter, wrapping `z.boolean()`, `.optional()` or `.default(…)`.
     * `z.coerce.boolean()` turns every non-empty string into `true`, so `?permanent=false`
     * deleted permanently. This takes `true`/`false`/`1`/`0` (and real booleans, for schemas
     * shared with JSON bodies), rejects anything else with a 400, and still shows up as a
     * plain boolean in the OpenAPI spec.
     */
    export function queryBoolean<T extends z.ZodBoolean | z.ZodOptional<z.ZodBoolean> | z.ZodDefault<z.ZodBoolean>>(schema: T) {
        return z.preprocess(fromQueryString, schema);
    }
}

export namespace ApiHelperModels.ListAll {

    export const Query = z.object({
        limit: z.coerce.number().int().positive().min(1).max(100).default(10),
        offset: z.coerce.number().int().min(0).default(0),
        order: z.enum(["newest", "oldest"]).default("newest")
    });

    export type Query = z.infer<typeof Query>;
    

    export const QueryWithSearch = Query.extend({
        searchString: z.string().optional(),
    });

    export type QueryWithSearch = z.infer<typeof QueryWithSearch>;

}

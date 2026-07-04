import { Hono } from "hono";
import { validator } from "hono-openapi";
import { BimiModel } from "./model";
import { BimiService } from "../../../../utils/services/bimiService";
import { APIResponse } from "../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { Logger } from "../../../../../utils/logger";

export const router = new Hono().basePath("/bimi");

router.get("/:domain",

    APIRouteSpec.authenticated({
        summary: "Resolve BIMI Record",
        description: "Resolve the BIMI (Brand Indicators for Message Identification) DNS record for a sender domain " +
            "and return the brand logo URL, which mail clients can render as a sender profile picture. " +
            "The logo SVG itself is never fetched or stored by the API — the returned `logoUrl` is loaded by the client directly.",
        tags: [DOCS_TAGS.BIMI],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("BIMI record resolved successfully", BimiModel.GetByDomain.Response),
            APIResponseSpec.notFound("No BIMI record found for the specified domain")
        )
    }),

    validator("param", BimiModel.GetByDomain.Params),
    validator("query", BimiModel.GetByDomain.Query),

    async (c) => {
        const { domain } = c.req.valid("param");
        const { selector } = c.req.valid("query");

        try {
            const record = await BimiService.resolve(domain, selector);

            if (!record) {
                return APIResponse.notFound(c, "No BIMI record found for the specified domain");
            }

            return APIResponse.success(c, "BIMI record resolved successfully",
                record satisfies BimiModel.GetByDomain.Response);
        } catch (e) {
            Logger.error("Failed to resolve BIMI record", e);
            return APIResponse.serverError(c, "Failed to resolve BIMI record");
        }
    }
);

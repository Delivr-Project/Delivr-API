import { Hono } from "hono";
import { MailsModel } from "./model";
import { DB } from "../../../../db";
import { and, eq } from "drizzle-orm";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { z } from "zod";
import { AuthHandler } from "../../../utils/authHandler";
import { validator } from "hono-openapi";
import { MailAccountsModel } from "../model";
import { router as attachmentsRouter } from "./attachments";

export const router = new Hono();

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List Mails",
        description: "Retrieve a list of mails for a specific mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mails retrieved successfully", MailsModel.GetAll.Response)
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        

    }
);


router.route('/', attachmentsRouter);


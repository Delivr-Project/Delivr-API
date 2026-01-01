import { Hono } from "hono";
import { MailAccountsModel } from './model';
import { validator } from "hono-openapi";
import { DB } from "../../../db";
import { eq } from "drizzle-orm";
import { APIResponse } from "../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { router as mailsRouter } from "./mails";
import { z } from "zod";

export const router = new Hono().basePath('/mail-accounts/:accountId');

router.route('/mails', mailsRouter);

router.get('/:id',
    APIRouteSpec.authenticated({
        summary: "Get Mail Account info",
        description: "Retrieve information about a specific mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MANAGEMENT],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail account retrieved successfully", MailAccountsModel.Get.Response),
            APIResponseSpec.notFound("Mail account not found")
        )
    }),
    async (c) => {
        const id = parseInt(c.req.param('id'));
        if (isNaN(id)) {
            return APIResponse.badRequest(c, "Invalid ID format");
        }

        const mailAccount = await DB.instance().select().from(DB.Schema.mailAccounts).where(eq(DB.Schema.mailAccounts.id, id)).get();

        if (!mailAccount) {
            return APIResponse.notFound(c, "Mail account not found");
        }

        return APIResponse.success(c, "Mail account retrieved successfully", mailAccount);
    }
);

router.post('/',
    APIRouteSpec.authenticated({
        summary: "Create mail account",
        description: "Create a new mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MANAGEMENT],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Mail account created successfully", MailAccountsModel.Get.Response)
        )
    }),
    validator("json", MailAccountsModel.Create.Body),
    async (c) => {
        const body = c.req.valid("json");
        const result = await DB.instance().insert(DB.Schema.mailAccounts).values(body).returning().get();
        return APIResponse.success(c, "Mail account created successfully", result);
    }
);

router.patch('/:id',
    APIRouteSpec.authenticated({
        summary: "Update mail account",
        description: "Update a field in a mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MANAGEMENT],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Mail account updated successfully", MailAccountsModel.Get.Response),
            APIResponseSpec.notFound("Mail account not found")
        )
    }),
    validator("json", MailAccountsModel.Update.Body),
    async (c) => {
        const id = parseInt(c.req.param('id'));
        if (isNaN(id)) {
            return APIResponse.badRequest(c, "Invalid ID format");
        }
        const body = c.req.valid("json");

        const existing = await DB.instance().select().from(DB.Schema.mailAccounts).where(eq(DB.Schema.mailAccounts.id, id)).get();
        if (!existing) {
            return APIResponse.notFound(c, "Mail account not found");
        }

        const result = await DB.instance().update(DB.Schema.mailAccounts).set(body).where(eq(DB.Schema.mailAccounts.id, id)).returning().get();
        return APIResponse.success(c, "Mail account updated successfully", result);
    }
);

router.delete('/:id',
    APIRouteSpec.authenticated({
        summary: "Delete mail account",
        description: "Delete a mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MANAGEMENT],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Mail account deleted successfully"),
            APIResponseSpec.notFound("Mail account not found")
        )
    }),
    async (c) => {
        const id = parseInt(c.req.param('id'));
        if (isNaN(id)) {
            return APIResponse.badRequest(c, "Invalid ID format");
        }

        const existing = await DB.instance().select().from(DB.Schema.mailAccounts).where(eq(DB.Schema.mailAccounts.id, id)).get();
        if (!existing) {
            return APIResponse.notFound(c, "Mail account not found");
        }

        await DB.instance().delete(DB.Schema.mailAccounts).where(eq(DB.Schema.mailAccounts.id, id)).run();
        return APIResponse.successNoData(c, "Mail account deleted successfully");
    }
);
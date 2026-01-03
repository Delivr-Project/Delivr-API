import { Hono } from "hono";
import { MailboxesModel } from "./model";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { z } from "zod";
import { validator } from "hono-openapi";
import { MailClientsCache } from "../../../../utils/mails/mail-clients-cache";
import { Logger } from "../../../../utils/logger";
import { MailboxService } from "../../../utils/services/maiboxService";
import { router as mailsRouter } from "./mails";

export const router = new Hono();

router.get('/',

    APIRouteSpec.authenticated({
        summary: "Get All Mailboxes",
        description: "Retrieve all mailboxes for the specified mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mailboxes retrieved successfully", MailboxesModel.GetAll.Response)
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            const mailboxes = await imap.getMailboxes();

            return APIResponse.success(c, "Mailboxes retrieved successfully", mailboxes satisfies MailboxesModel.GetAll.Response);
        } catch (e) {
            Logger.error(`Failed to retrieve mailboxes`, e);
            return APIResponse.serverError(c, `Failed to retrieve mailboxes`);
        }
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create new Mailbox",
        description: "Create a new mail mailbox for the specified mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Mailbox created successfully")
        )
    }),

    validator("json", MailboxesModel.Create.Body),

    async (c) => {
        const body = c.req.valid("json");

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            await imap.createMailbox(body.path);

            const mailbox = await imap.getMailbox(body.path);
            if (!mailbox) {
                return APIResponse.serverError(c, "Failed to verify created mailbox");
            }

            return APIResponse.successNoData(c, "Mailbox created successfully");
        } catch (e) {
            Logger.error(`Failed to create mail mailbox with path ${body.path}`, e);
            return APIResponse.serverError(c, `Failed to create mail mailbox with path ${body.path}`);
        }
    }
);

router.use('/:mailboxPath/*',

    validator('param', MailboxesModel.Params),

    async (c, next) => {
        // @ts-ignore
        const { mailboxPath } = c.req.valid('param') as MailboxesModel.Params;
        
        return MailboxService.mailboxMiddleware(c, next, mailboxPath);
    }
);

router.get('/:mailboxPath',

    APIRouteSpec.authenticated({
        summary: "Get Mailbox Info",
        description: "Retrieve information about a specific mail mailbox for the specified mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mailbox info retrieved successfully", MailboxesModel.GetByPath.Response),
            APIResponseSpec.notFound("Mailbox with specified path not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.Mailbox;

        return APIResponse.success(c, "Mailbox info retrieved successfully", mailbox satisfies MailboxesModel.GetByPath.Response);
    }
);

router.put('/:mailboxPath',

    APIRouteSpec.authenticated({
        summary: "Update Mailbox",
        description: "Update a specific mail mailbox for the specified mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Mailbox updated successfully"),
            APIResponseSpec.notFound("Mailbox with specified path not found")
        )
    }),

    validator("json", MailboxesModel.Update.Body),

    async (c) => {
        const body = c.req.valid("json");

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.Mailbox;

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            await imap.renameMailbox(mailbox.path, body.name);

            return APIResponse.successNoData(c, "Mailbox updated successfully");
        } catch (e) {
            Logger.error(`Failed to update mail mailbox with path ${mailbox.path}`, e);
            return APIResponse.serverError(c, `Failed to update mail mailbox with path ${mailbox.path}`);
        }
    }
);

router.delete('/:mailboxPath',

    APIRouteSpec.authenticated({
        summary: "Delete Mailbox",
        description: "Delete a specific mail mailbox for the specified mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Mailbox deleted successfully"),
            APIResponseSpec.notFound("Mailbox with specified path not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.Mailbox;

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            await imap.deleteMailbox(mailbox.path);

            return APIResponse.successNoData(c, "Mailbox deleted successfully");
        } catch (e) {
            Logger.error(`Failed to delete mail mailbox with path ${mailbox.path}`, e);
            return APIResponse.serverError(c, `Failed to delete mail mailbox with path ${mailbox.path}`);
        }
    }
);

router.route('/:mailboxPath/mails', mailsRouter);
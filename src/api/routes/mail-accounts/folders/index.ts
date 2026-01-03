import { Hono } from "hono";
import { MailboxModel } from "./model";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { z } from "zod";
import { validator } from "hono-openapi";
import { MailClientsCache } from "../../../../utils/mails/mail-clients-cache";
import { Logger } from "../../../../utils/logger";
import { MailboxService } from "../../../utils/services/mailFolderService";

export const router = new Hono();

router.get('/',

    APIRouteSpec.authenticated({
        summary: "Get All Folders",
        description: "Retrieve all mail folders for the specified mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.FOLDERS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Folders retrieved successfully", MailboxModel.GetAll.Response)
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            const mailboxes = await imap.getMailboxes();

            return APIResponse.success(c, "Folders retrieved successfully", mailboxes satisfies MailboxModel.GetAll.Response);
        } catch (e) {
            Logger.error(`Failed to retrieve mail folders`, e);
            return APIResponse.serverError(c, `Failed to retrieve mail folders`);
        }
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create Folder",
        description: "Create a new mail folder for the specified mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.FOLDERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Folder created successfully")
        )
    }),

    validator("json", MailboxModel.Create.Body),

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
                return APIResponse.serverError(c, "Failed to verify created folder");
            }

            return APIResponse.successNoData(c, "Folder created successfully");
        } catch (e) {
            Logger.error(`Failed to create mail folder with path ${body.path}`, e);
            return APIResponse.serverError(c, `Failed to create mail folder with path ${body.path}`);
        }
    }
);

router.use('/:mailboxPath/*',

    validator('param', MailboxModel.Params),

    async (c, next) => {
        // @ts-ignore
        const { mailboxPath } = c.req.valid('param') as MailboxModel.Params;
        
        return MailboxService.mailboxMiddleware(c, next, mailboxPath);
    }
);

router.get('/:mailboxPath',

    APIRouteSpec.authenticated({
        summary: "Get Folder Info",
        description: "Retrieve information about a specific mail folder for the specified mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.FOLDERS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Folder info retrieved successfully", MailboxModel.GetByPath.Response),
            APIResponseSpec.notFound("Mailbox with specified path not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxModel.Base;

        return APIResponse.success(c, "Folder info retrieved successfully", mailbox satisfies MailboxModel.GetByPath.Response);
    }
);

router.put('/:mailboxPath',

    APIRouteSpec.authenticated({
        summary: "Update Folder",
        description: "Update a specific mail folder for the specified mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.FOLDERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Folder updated successfully"),
            APIResponseSpec.notFound("Mailbox with specified path not found")
        )
    }),

    validator("json", MailboxModel.Update.Body),

    async (c) => {
        const body = c.req.valid("json");

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxModel.Base;

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            await imap.renameMailbox(mailbox.path, body.name);

            return APIResponse.successNoData(c, "Folder updated successfully");
        } catch (e) {
            Logger.error(`Failed to update mail folder with path ${mailbox.path}`, e);
            return APIResponse.serverError(c, `Failed to update mail folder with path ${mailbox.path}`);
        }
    }
);

router.delete('/:mailboxPath',

    APIRouteSpec.authenticated({
        summary: "Delete Folder",
        description: "Delete a specific mail folder for the specified mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.FOLDERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Folder deleted successfully"),
            APIResponseSpec.notFound("Mailbox with specified path not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxModel.Base;

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            await imap.deleteMailbox(mailbox.path);

            return APIResponse.successNoData(c, "Folder deleted successfully");
        } catch (e) {
            Logger.error(`Failed to delete mail folder with path ${mailbox.path}`, e);
            return APIResponse.serverError(c, `Failed to delete mail folder with path ${mailbox.path}`);
        }
    }
);
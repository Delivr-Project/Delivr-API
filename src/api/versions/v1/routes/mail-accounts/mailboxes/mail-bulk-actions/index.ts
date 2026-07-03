import { Hono } from "hono";
import { APIResponseSpec, APIRouteSpec } from "../../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../../docs";
import { MailBulkActionsModel } from "./model";
import { validator } from "hono-openapi";
import { APIResponse } from "../../../../../../utils/api-res";
import { Logger } from "../../../../../../../utils/logger";
import { MailClientsCache } from "../../../../../../../utils/mails/mail-clients-cache";


export const router = new Hono();


router.post('/move',

    APIRouteSpec.authenticated({
        summary: "Bulk Move Mails",
        description: "Move multiple mails to another mailbox/folder.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAIL_BULK_ACTIONS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Mails moved successfully", MailBulkActionsModel.BulkMove.Response),
            APIResponseSpec.notFound("Mailbox with specified path not found")
        )
    }),

    validator('json', MailBulkActionsModel.BulkMove.Body),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;

        const body = c.req.valid('json');

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            await imap.moveToMailbox(mailbox.path, body.uids, body.targetMailbox);

            return APIResponse.success(c, "Mails moved successfully", { success: true } satisfies MailBulkActionsModel.BulkMove.Response);
        } catch (e) {
            Logger.error("Failed to bulk move mails", e);
            return APIResponse.serverError(c, "Failed to move mails");
        }
    }
);

router.post('/copy',

    APIRouteSpec.authenticated({
        summary: "Bulk Copy Mails",
        description: "Copy multiple mails to another mailbox/folder.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAIL_BULK_ACTIONS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Mails copied successfully", MailBulkActionsModel.BulkCopy.Response),
            APIResponseSpec.notFound("Mailbox with specified path not found")
        )
    }),

    validator('json', MailBulkActionsModel.BulkCopy.Body),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;

        const body = c.req.valid('json');

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            await imap.copyToMailbox(mailbox.path, body.uids, body.targetMailbox);

            return APIResponse.success(c, "Mails copied successfully", { success: true } satisfies MailBulkActionsModel.BulkCopy.Response);
        } catch (e) {
            Logger.error("Failed to bulk copy mails", e);
            return APIResponse.serverError(c, "Failed to copy mails");
        }
    }
);

router.post('/delete',

    APIRouteSpec.authenticated({
        summary: "Bulk Delete Mails",
        description: "Delete multiple mails by moving them to trash, or permanently delete them.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAIL_BULK_ACTIONS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Mails deleted successfully", MailBulkActionsModel.BulkDelete.Response),
            APIResponseSpec.notFound("Mailbox with specified path not found")
        )
    }),

    validator('json', MailBulkActionsModel.BulkDelete.Body),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;

        const body = c.req.valid('json');

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();

            if (body.permanent) {
                await imap.permanentlyDelete(mailbox.path, body.uids);
            } else {
                await imap.moveToTrash(mailbox.path, body.uids);
            }

            return APIResponse.success(c, "Mails deleted successfully", { success: true } satisfies MailBulkActionsModel.BulkDelete.Response);
        } catch (e) {
            Logger.error("Failed to bulk delete mails", e);
            return APIResponse.serverError(c, "Failed to delete mails");
        }
    }
);

import { Hono } from "hono";
import { APIResponseSpec, APIRouteSpec } from "../../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../../docs";
import { MailBulkActionsModel } from "./model";
import { validator } from "hono-openapi";
import { APIResponse } from "../../../../../../utils/api-res";
import { Logger } from "../../../../../../../utils/logger";
import { MailClientsCache } from "../../../../../../../utils/mails/mail-clients-cache";
import { SpecialUseHandler } from "../../../../../../utils/services/specialUseService";


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
                const trashPath = await SpecialUseHandler.resolveTrashPath(mailAccount.id, imap);
                await imap.moveToTrash(mailbox.path, body.uids, trashPath);
            }

            return APIResponse.success(c, "Mails deleted successfully", { success: true } satisfies MailBulkActionsModel.BulkDelete.Response);
        } catch (e) {
            Logger.error("Failed to bulk delete mails", e);
            return APIResponse.serverError(c, "Failed to delete mails");
        }
    }
);

router.post('/flags',

    APIRouteSpec.authenticated({
        summary: "Bulk Set Mail Flags",
        description: "Set message flags such as the seen/read state on multiple mails at once. Only the flags present in the body are changed (`true` sets the flag, `false` clears it); omitted flags are left untouched.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAIL_BULK_ACTIONS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Mail flags updated successfully", MailBulkActionsModel.BulkSetFlags.Response),
            APIResponseSpec.notFound("Mailbox with specified path not found")
        )
    }),

    validator('json', MailBulkActionsModel.BulkSetFlags.Body),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;

        const body = c.req.valid('json');

        // Map user-facing flag names to their IMAP system flags. `\Recent` is
        // server-managed and cannot be set by clients, so it is intentionally omitted.
        const FLAG_MAP: Record<string, string> = {
            seen: '\\Seen',
            answered: '\\Answered',
            flagged: '\\Flagged',
            draft: '\\Draft',
            deleted: '\\Deleted'
        };

        const flagsToAdd: string[] = [];
        const flagsToRemove: string[] = [];
        for (const [key, imapFlag] of Object.entries(FLAG_MAP)) {
            const value = body.flags[key as keyof MailBulkActionsModel.BulkSetFlags.Body['flags']];
            if (value === true) flagsToAdd.push(imapFlag);
            else if (value === false) flagsToRemove.push(imapFlag);
        }

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            if (flagsToAdd.length > 0) await imap.addFlags(mailbox.path, body.uids, flagsToAdd);
            if (flagsToRemove.length > 0) await imap.removeFlags(mailbox.path, body.uids, flagsToRemove);

            return APIResponse.success(c, "Mail flags updated successfully", { success: true } satisfies MailBulkActionsModel.BulkSetFlags.Response);
        } catch (e) {
            Logger.error("Failed to bulk update mail flags", e);
            return APIResponse.serverError(c, "Failed to update mail flags");
        }
    }
);

import { Hono } from "hono";
import { validator } from "hono-openapi";
import { SpecialUseModel } from "./model";
import { MailAccountsModel } from "../model";
import { APIResponse } from "../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { MailClientsCache } from "../../../../../../utils/mails/mail-clients-cache";
import { SpecialUseHandler, SpecialUse } from "../../../../../utils/services/specialUseService";
import { Logger } from "../../../../../../utils/logger";

export const router = new Hono();

router.get('/',

    APIRouteSpec.authenticated({
        summary: "Get special-use folder mapping",
        description: "Retrieve the resolved special-use folder mapping (drafts/sent/spam/trash/archive) for the account. Detected and persisted by the backend; user overrides are preserved.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Special-use mapping retrieved successfully", SpecialUseModel.Get.Response)
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            const mailboxes = await imap.getMailboxes();
            const mapping = await SpecialUseHandler.resolve(mailAccount.id, mailboxes);

            return APIResponse.success(c, "Special-use mapping retrieved successfully", mapping satisfies SpecialUseModel.Get.Response);
        } catch (e) {
            Logger.error(`Failed to retrieve special-use mapping for mail account ${mailAccount.id}`, e);
            return APIResponse.serverError(c, "Failed to retrieve special-use mapping");
        }
    }
);

router.put('/',

    APIRouteSpec.authenticated({
        summary: "Update special-use folder mapping",
        description: "Override which folders are the account's special folders. Each type maps to a folder path, \"\" (empty string) for an explicit \"none\" that is persisted and blocks re-detection, or null to clear the override and revert to auto-detection. A folder can only be one special type.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Special-use mapping updated successfully", SpecialUseModel.Update.Response)
        )
    }),

    validator("json", SpecialUseModel.Update.Body),

    async (c) => {
        const body = c.req.valid("json");

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            const mailboxes = await imap.getMailboxes();
            const paths = new Set(mailboxes.map((mb) => mb.path));

            // Reject overrides that point at a folder that doesn't exist. `null`
            // (revert to auto) and `""` (explicit none) carry no path to validate.
            for (const type of SpecialUse.EDITABLE_TYPES) {
                const path = body[type];
                if (path != null && path !== '' && !paths.has(path)) {
                    return APIResponse.badRequest(c, `No folder found at path "${path}" for special-use "${type}"`);
                }
            }

            const mapping = await SpecialUseHandler.setOverrides(mailAccount.id, mailboxes, body);

            return APIResponse.success(c, "Special-use mapping updated successfully", mapping satisfies SpecialUseModel.Update.Response);
        } catch (e) {
            Logger.error(`Failed to update special-use mapping for mail account ${mailAccount.id}`, e);
            return APIResponse.serverError(c, "Failed to update special-use mapping");
        }
    }
);

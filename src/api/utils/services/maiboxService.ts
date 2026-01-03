import type { Context } from "hono";
import { MailClientsCache } from "../../../utils/mails/mail-clients-cache";
import { APIResponse } from "../api-res";
import { Logger } from "../../../utils/logger";
import type { MailboxesModel } from "../../routes/mail-accounts/mailboxes/model";


export class MailboxService {

    static async mailboxMiddleware(c: Context, next: () => Promise<void>, mailboxPath: string) {

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        
        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            const mailbox = await imap.getMailbox(mailboxPath) satisfies MailboxesModel.BASE | null;

            if (!mailbox) {
                return APIResponse.notFound(c, "Mailbox with specified path not found");
            }

            // @ts-ignore
            c.set("mailboxData", mailbox);

            await next();
        } catch (e) {
            Logger.error(`Failed to access mailbox with path ${mailboxPath}`, e);
            return APIResponse.serverError(c, `Failed to access mailbox with path ${mailboxPath}`);
        }
    }
    
}

import type { Context } from "hono";
import { MailClientsCache } from "../../../utils/mails/mail-clients-cache";
import { APIResponse } from "../api-res";
import { Logger } from "../../../utils/logger";

export class MailFolderService {

    static async folderMiddleware(c: Context, next: () => Promise<void>, folderPath: string) {

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        
        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            const folderExists = await imap.getMailboxStatus(folderPath) !== null;

            if (!folderExists) {
                return APIResponse.notFound(c, "Folder with specified path not found");
            }

            await next();
        } catch (e) {
            Logger.error(`Failed to access folder with path ${folderPath}`, e);
            return APIResponse.serverError(c, `Failed to access folder with path ${folderPath}`);
        }
    }
    
}

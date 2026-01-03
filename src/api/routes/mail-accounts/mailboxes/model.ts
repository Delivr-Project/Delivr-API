import { z } from "zod";
import type { Utils } from "../../../../utils";
import type { MailboxRessource } from "../../../../utils/mails/ressources/mailbox";

export namespace MailboxesModel {
    
    export const Mailbox = z.object({
        name: z.string(),
        path: z.string(),
        delimiter: z.string(),
        parent: z.array(z.string()),
        parentPath: z.string(),
        flags: z.array(z.string()),
        specialUse: z.string().optional()
    });

    export type Mailbox = Utils.SameType<z.infer<typeof Mailbox>, MailboxRessource.IMailbox>;


    export const MailboxStatus = z.object({
        messages: z.number().min(0).meta({ title: "Total number of messages in the mailbox" }),
        recent: z.number().min(0).meta({ title: "Number of recent messages in the mailbox" }),
        unseen: z.number().min(0).meta({ title: "Number of unseen (unread) messages in the mailbox" })
    });

    export const Params = z.object({
        mailboxPath: z.codec(
            z.string().meta({ title: "URI-encoded mailbox path" }),
            z.string().meta({ title: "Decoded mailbox path" }),
            {
                encode: (val) => encodeURIComponent(val),
                decode: (val) => decodeURIComponent(val)
            }
        )
    });
    export type Params = z.infer<typeof Params>;

}

export namespace MailboxesModel.GetByPath {

    export const Response = MailboxesModel.Mailbox.omit({
        
    });

    export type Response = z.infer<typeof Response>;

}

export namespace MailboxesModel.GetAll {

    export const Response = z.array(MailboxesModel.GetByPath.Response);
    export type Response = z.infer<typeof Response>;

}


export namespace MailboxesModel.Create {

    export const Body = MailboxesModel.Mailbox.pick({
        path: true
    });

    export type Body = z.infer<typeof Body>;

}

export namespace MailboxesModel.Update {

    export const Body = MailboxesModel.Mailbox.pick({
        name: true
    });

    export type Body = z.infer<typeof Body>;

}
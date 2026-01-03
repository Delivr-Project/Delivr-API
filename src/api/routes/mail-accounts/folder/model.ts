import { z } from "zod";
import type { Utils } from "../../../../utils";
import type { MailboxRessource } from "../../../../utils/mails/ressources/mailbox";

export namespace MailboxModel {
    
    export const Base = z.object({
        name: z.string(),
        path: z.string(),
        delimiter: z.string(),
        parent: z.array(z.string()),
        parentPath: z.string(),
        flags: z.array(z.string()),
        specialUse: z.string().optional()
    });

    export type Base = Utils.SameType<z.infer<typeof Base>, MailboxRessource.IMailbox>;


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

export namespace MailboxModel.GetByPath {

    export const Response = MailboxModel.Base.omit({
        path: true,
    });

    export type Response = z.infer<typeof Response>;

}

export namespace MailboxModel.GetAll {

    export const Response = z.array(MailboxModel.GetByPath.Response);
    export type Response = z.infer<typeof Response>;

}


export namespace MailboxModel.Create {

    export const Body = MailboxModel.Base.pick({
        path: true
    });

    export type Body = z.infer<typeof Body>;

}

export namespace MailboxModel.Update {

    export const Body = MailboxModel.Base.pick({
        name: true
    });

    export type Body = z.infer<typeof Body>;

}
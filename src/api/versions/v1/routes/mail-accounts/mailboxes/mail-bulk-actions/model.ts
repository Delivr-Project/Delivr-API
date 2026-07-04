import { z } from "zod";

export namespace MailBulkActionsModel.BulkMove {

    export const Body = z.object({
        uids: z.array(z.number()).min(1).describe("UIDs of the mails to move"),
        targetMailbox: z.string().describe("The path of the target mailbox to move the mails to")
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        success: z.boolean()
    });

    export type Response = z.infer<typeof Response>;
}

export namespace MailBulkActionsModel.BulkCopy {

    export const Body = z.object({
        uids: z.array(z.number()).min(1).describe("UIDs of the mails to copy"),
        targetMailbox: z.string().describe("The path of the target mailbox to copy the mails to")
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        success: z.boolean()
    });

    export type Response = z.infer<typeof Response>;
}

export namespace MailBulkActionsModel.BulkDelete {

    export const Body = z.object({
        uids: z.array(z.number()).min(1).describe("UIDs of the mails to delete"),
        permanent: z.boolean().default(false).describe("If true, permanently delete the mails. Otherwise, move to Trash.")
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        success: z.boolean()
    });

    export type Response = z.infer<typeof Response>;
}

export namespace MailBulkActionsModel.BulkSetFlags {

    /** Only the provided flags are changed; `true` sets the flag, `false` clears it. */
    export const Body = z.object({
        uids: z.array(z.number()).min(1).describe("UIDs of the mails to update"),
        flags: z.object({
            seen: z.boolean().optional(),
            answered: z.boolean().optional(),
            flagged: z.boolean().optional(),
            deleted: z.boolean().optional(),
            draft: z.boolean().optional()
        }).describe("Flags to set or clear on the selected mails")
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        success: z.boolean()
    });

    export type Response = z.infer<typeof Response>;
}

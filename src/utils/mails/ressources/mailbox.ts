import { type ListResponse as MailboxListResponse, type ListTreeResponse as MailboxTreeResponse } from "imapflow";

export class MailboxRessource implements MailboxRessource.IMailbox {

    readonly name: string;
    readonly path: string;
    readonly delimiter: string;
    readonly parent: string[];
    readonly parentPath: string;
    readonly flags: string[];
    readonly specialUse?: string;
    readonly status: MailboxRessource.MailboxStatus;

    constructor(data: MailboxRessource.IMailbox) {
        this.name = data.name;
        this.path = data.path;
        this.delimiter = data.delimiter;
        this.parent = data.parent;
        this.parentPath = data.parentPath;
        this.flags = data.flags;
        this.specialUse = data.specialUse;
        this.status = data.status;
    }

    static async fromIMAPMailbox(mailbox: MailboxListResponse): Promise<MailboxRessource | null> {
        return new MailboxRessource({
            name: mailbox.name,
            path: mailbox.path,
            delimiter: mailbox.delimiter,
            parent: mailbox.parent,
            parentPath: mailbox.parentPath,
            flags: mailbox.flags.values().toArray(),
            specialUse: mailbox.specialUse,
            status: {
                messages: mailbox.status?.messages || 0,
                unseen: mailbox.status?.unseen || 0,
                recent: mailbox.status?.recent || 0
            }
        });
    }

    static async fromIMAPMailboxes(mailboxes: MailboxListResponse[]): Promise<MailboxRessource[]> {
        const result: MailboxRessource[] = [];

        for (const mailbox of mailboxes) {
            const res = await this.fromIMAPMailbox(mailbox);
            if (res) {
                result.push(res);
            }
        }
        return result;
    }
}

export namespace MailboxRessource {

    export interface IMailbox {
        /** Mailbox name (last part of path after delimiter) */
        name: string;
        /** Mailbox path (unicode string) */
        path: string;

        /** Mailbox path delimiter, usually "." or "/" */
        delimiter: string;
        /** An array of parent folder names. All names are in unicode */
        parent: string[];
        /** Same as parent, but as a complete string path (unicode string) */
        parentPath: string;
        /** A set of flags for this mailbox */
        flags: string[];
        /** One of special-use flags (if applicable) */
        specialUse?: string;
        /** Mailbox status information */
        status: MailboxStatus;
    }

    export interface MailboxStatus {
        messages: number;
        recent: number;
        unseen: number;
    }

}
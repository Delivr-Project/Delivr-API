import { type ListResponse as MailboxListResponse, type ListTreeResponse as MailboxTreeResponse } from "imapflow";

export class MailboxRessource implements MailboxRessource.IMailbox {

    readonly name: string;
    readonly path: string;
    readonly delimiter: string;
    readonly parent: string[];
    readonly parentPath: string;
    readonly flags: string[];
    readonly specialUse?: string;

    constructor(data: MailboxRessource.IMailbox) {
        this.name = data.name;
        this.path = data.path;
        this.delimiter = data.delimiter;
        this.parent = data.parent;
        this.parentPath = data.parentPath;
        this.flags = data.flags;
        this.specialUse = data.specialUse;
    }

    static async fromIMAPMailbox(mailbox: MailboxListResponse): Promise<MailboxRessource> {
        return new MailboxRessource({
            name: mailbox.name,
            path: mailbox.path,
            delimiter: mailbox.delimiter,
            parent: mailbox.parent,
            parentPath: mailbox.parentPath,
            flags: mailbox.flags.values().toArray(),
            specialUse: mailbox.specialUse
        });
    }

    static fromIMAPMailboxes(mailboxes: MailboxListResponse[]): Promise<MailboxRessource[]> {
        return Promise.all(mailboxes.map(mailbox => this.fromIMAPMailbox(mailbox)));
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
    }

    export interface MailboxStatus {
        messages: number;
        recent: number;
        unseen: number;
    }

}
import type { FetchMessageObject } from "imapflow";
import { MailParser } from "../parser";

export class MailRessource implements MailRessource.IMail {

    readonly uid: number;
    readonly rawHeaders: MailRessource.MailHeaders;
    readonly rawFlags: string[];

    readonly from?: MailRessource.EmailAddress;
    readonly to: MailRessource.EmailAddress[];
    readonly cc: MailRessource.EmailAddress[];
    readonly bcc: MailRessource.EmailAddress[];

    readonly subject?: string;
    readonly references?: string | string[];
    readonly date?: number;
    readonly flags?: MailRessource.MailFlags;

    readonly replyTo?: MailRessource.EmailAddress[];
    readonly messageId?: string;
    readonly inReplyTo?: string;

    readonly priority?: "normal" | "low" | "high" | undefined;

    readonly attachments: MailRessource.MailAttachment[];
    readonly body: MailRessource.MailBody;

    constructor(data: MailRessource.IMail) {
        this.uid = data.uid;
        this.rawHeaders = data.rawHeaders;
        this.rawFlags = data.rawFlags;

        this.from = data.from;
        this.to = data.to;
        this.cc = data.cc;
        this.bcc = data.bcc;

        this.subject = data.subject;
        this.references = data.references;
        this.date = data.date;
        this.flags = data.flags;
        
        this.replyTo = data.replyTo;
        this.messageId = data.messageId;
        this.inReplyTo = data.inReplyTo;
        
        this.priority = data.priority;

        this.attachments = data.attachments;
        this.body = data.body;
    }

    static async fromIMAPMessage(mail: FetchMessageObject) {
        if (!mail.source) {
            return null;
        }
        const parsedMail = await MailParser.parseMail(mail.uid, mail.source, {
            rawFlags: mail.flags
        });
        return new MailRessource(parsedMail);
    }

    static async fromIMAPMessages(mails: FetchMessageObject[]) {
        const mailRessources: MailRessource[] = [];
        for (const mail of mails) {
            const mailRessource = await MailRessource.fromIMAPMessage(mail);
            if (mailRessource) {
                mailRessources.push(mailRessource);
            }
        }
        return mailRessources;
    }

    /**
     * Check if email has attachments
     * @returns True if email has attachments
     */
    public hasAttachments(): boolean {
        return this.attachments.length > 0;
    }

    /**
     * Get attachments by content type
     * @param contentType - Content type to filter by (e.g., 'image/png')
     * @returns Filtered attachments
     */
    public getAttachmentsByType(contentType: string): MailRessource.MailAttachment[] {
        return this.attachments.filter(att => att.contentType === contentType);
    }

    /**
     * Get inline attachments (embedded images, etc.)
     * @returns Inline attachments
     */
    public getInlineAttachments(): MailRessource.MailAttachment[] {
        return this.attachments.filter(att => 
            att.contentDisposition === 'inline' || att.contentId
        );
    }

    /**
     * Get regular (non-inline) attachments
     * @returns Regular attachments
     */
    public getRegularAttachments(): MailRessource.MailAttachment[] {
        return this.attachments.filter(att => 
            att.contentDisposition !== 'inline' && !att.contentId
        );
    }

}

export namespace MailRessource {

    export interface IMail {
        uid: number;

        rawHeaders: MailHeaders;
        rawFlags: string[];

        from?: EmailAddress;
        to: EmailAddress[];
        cc: EmailAddress[];
        bcc: EmailAddress[];

        subject?: string;
        references?: string | string[];
        date?: number;
        flags?: MailFlags;

        replyTo?: EmailAddress[];
        messageId?: string;
        inReplyTo?: string;
            
        priority?: "normal" | "low" | "high" | undefined;

        attachments: MailAttachment[];
        body: MailBody;
    }

    export interface EmailAddress {
        name?: string;
        address: string;
    }

    export interface MailFlags {
        seen?: boolean;
        answered?: boolean;
        flagged?: boolean;
        deleted?: boolean;
        draft?: boolean;
        recent?: boolean;
    }

    export interface MailAttachment {
        /** Stable index of this attachment within the mail, used to fetch its content. */
        id: number;
        filename?: string;
        contentType: string;
        size: number;
        contentId?: string;
        contentDisposition?: string;
    }


    export type MailHeaders = Record<string, string>;

    export interface MailBody {
        text?: string;
        html?: string;
    }

}
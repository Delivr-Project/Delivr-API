import type { FetchMessageObject } from "imapflow";
import { MailParser } from "./parser";

export class MailRessource implements MailRessource.IMail {

    readonly uid: number;
    readonly rawHeaders: MailRessource.MailHeaders = {};
    readonly from?: MailRessource.EmailAddress;
    readonly to?: MailRessource.EmailAddress[];
    readonly cc?: MailRessource.EmailAddress[];
    readonly bcc?: MailRessource.EmailAddress[];
    readonly subject?: string;
    readonly inReplyTo?: string;
    readonly replyTo?: MailRessource.EmailAddress;
    readonly references?: string | string[];
    readonly date?: number;
    readonly attachments: MailRessource.MailAttachment[] = [];
    readonly body?: MailRessource.MailBody;

    constructor(data: MailRessource.IMail) {
        this.uid = data.uid;
        this.rawHeaders = data.rawHeaders;
        this.from = data.from;
        this.to = data.to;
        this.cc = data.cc;
        this.bcc = data.bcc;
        this.subject = data.subject;
        this.inReplyTo = data.inReplyTo;
        this.replyTo = data.replyTo;
        this.references = data.references;
        this.date = data.date;
        this.attachments = data.attachments;
        this.body = data.body;
    }

    static async fromIMAPMessage(mail: FetchMessageObject) {
        if (!mail.source) {
            return null;
        }
        const parsedMail = await MailParser.parseMail(mail.uid, mail.source);
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
        from?: EmailAddress;
        to?: EmailAddress[];
        cc?: EmailAddress[];
        bcc?: EmailAddress[];
        subject?: string;
        // @todo add replyTo
        inReplyTo?: string;
        replyTo?: EmailAddress
        references?: string | string[];
        date?: number;
        attachments: MailAttachment[];
        body?: MailBody;
    }

    export interface EmailAddress {
        name?: string;
        address: string;
    }

    export interface MailAttachment {
        filename?: string;
        contentType: string;
        size: number;
        // @TODO return url to get the content from later
        // content: Buffer;
        contentId?: string;
        contentDisposition?: string;
    }


    export type MailHeaders = Record<string, string>;

    export interface MailBody {
        text?: string;
        html?: string;
    }

}
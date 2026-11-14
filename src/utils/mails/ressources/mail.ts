import type { FetchMessageObject, MessageStructureObject } from "imapflow";
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

    /** Most source bytes fetched for a summary: headers + start of the text. */
    static readonly SUMMARY_SOURCE_BYTES = 64 * 1024;

    /** Source bytes fetched first; enough for the headers and preview of most mails. */
    static readonly SUMMARY_FIRST_BYTES = 16 * 1024;

    /** Whether `mail.source`, fetched with the given limit, is the whole mail. */
    private static hasWholeSource(mail: FetchMessageObject, sourceLimit: number) {
        return !!mail.source
            && (mail.source.length < sourceLimit || (mail.size !== undefined && mail.source.length >= mail.size));
    }

    /**
     * List view of a mail: full headers, preview-only body.
     *
     * @param sourceLimit - the limit `mail.source` was fetched with
     */
    static async summaryFromIMAPMessage(mail: FetchMessageObject, sourceLimit = MailRessource.SUMMARY_SOURCE_BYTES) {
        if (!mail.source) {
            return null;
        }
        const parsedMail = await MailParser.parseMail(mail.uid, mail.source, {
            rawFlags: mail.flags
        });

        const isComplete = MailRessource.hasWholeSource(mail, sourceLimit);

        return new MailRessource({
            ...parsedMail,
            body: MailParser.getPreviewBody(parsedMail.body),
            // a cut-off source misses attachments, so read them from the structure
            attachments: isComplete ? parsedMail.attachments : MailParser.attachmentsFromStructure(mail.bodyStructure)
        });
    }

    /**
     * Whether a summary built from the first `sourceLimit` bytes could still
     * change with more of the source: the headers are cut off, or the preview is
     * short although the text goes on beyond the fetched bytes.
     */
    static summaryNeedsMoreSource(mail: FetchMessageObject, summary: MailRessource, sourceLimit: number) {
        if (!mail.source || MailRessource.hasWholeSource(mail, sourceLimit)) return false;

        const headers = MailParser.headerBlockOf(mail.source);
        if (!headers) return true;

        // the cut can drop half a surrogate pair, hence one less
        if ((summary.body.text?.length ?? 0) >= MailParser.PREVIEW_LENGTH - 1) return false;

        return !MailRessource.textEndsWithin(mail.bodyStructure, mail.source.length - headers.length);
    }

    /**
     * Whether every body text ends within the first `bodyBytes` of the body,
     * estimated generously from the part sizes (the real offsets aren't known).
     */
    private static textEndsWithin(root: MessageStructureObject | undefined, bodyBytes: number) {
        if (!root) return false;

        const PART_OVERHEAD_BYTES = 512; // boundary line and part headers
        let offset = 0;
        let textEnd = 0;

        const walk = (node: MessageStructureObject) => {
            offset += PART_OVERHEAD_BYTES;

            if (node.childNodes?.length) {
                for (const child of node.childNodes) walk(child);
                return;
            }

            offset += node.size ?? 0;
            if ((node.type === 'text/plain' || node.type === 'text/html') && node.disposition !== 'attachment') {
                textEnd = offset;
            }
        };
        walk(root);

        return textEnd > 0 && textEnd + PART_OVERHEAD_BYTES <= bodyBytes;
    }

    static async summariesFromIMAPMessages(mails: FetchMessageObject[]) {
        const mailRessources: MailRessource[] = [];
        for (const mail of mails) {
            const mailRessource = await MailRessource.summaryFromIMAPMessage(mail);
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
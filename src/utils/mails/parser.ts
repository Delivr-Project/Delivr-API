import PostalMime, { type HeaderLine, type Attachment, type Address as AddressObject } from 'postal-mime';
import type { Stream } from 'nodemailer/lib/xoauth2';
import type { MailRessource } from './ressources/mail';

export class MailParser {

    /**
     * Parse an email from a buffer or string
     * @param source - Email source as Buffer or string
     * @returns Parsed and sanitized email data
     */
    static async parseMail(uid: number, source: string | ArrayBuffer | Uint8Array | Blob | Buffer | ReadableStream, additionalData: { rawFlags?: Set<string> | string[] }): Promise<MailRessource.IMail> {
        const parsed = await PostalMime.parse(source, {
            
        });

        return {
            uid,

            rawHeaders: this.getHeadersDict(parsed.headerLines),
            rawFlags: Array.from(additionalData.rawFlags || []),

            from: this.parseAddresses(parsed.from),
            to: this.parseAddresses(parsed.to, true),
            cc: this.parseAddresses(parsed.cc, true),
            bcc: this.parseAddresses(parsed.bcc, true),

            subject: parsed.subject,
            references: parsed.references,
            date: parsed.date ? new Date(parsed.date).getTime() : undefined,
            flags: this.parseRawFlags(additionalData.rawFlags || []),

            replyTo: this.parseAddresses(parsed.replyTo, true),
            messageId: parsed.messageId,
            inReplyTo: parsed.inReplyTo,
            
            priority: parsed.headers.find(h => h.key.toLowerCase() === 'x-priority')?.value?.toLowerCase() === 'high' ? 'high' :
                      parsed.headers.find(h => h.key.toLowerCase() === 'x-priority')?.value?.toLowerCase() === 'low' ? 'low' :
                      'normal',
            
            attachments: this.parseAttachments(parsed.attachments),
            body: this.getBody(parsed.text, parsed.html)
        };
    }

    static async convertToBuffer(source: MailRessource.IMail) {
        let mailOptions: any = {};

        
    }
    
    /**
     * Parse email addresses from ParsedMail format
     * @param addressObject - Address object from mailparser
     * @returns Array of parsed email addresses
     */
    private static parseAddresses(addressObject?: AddressObject, forceArray?: false): MailRessource.EmailAddress | undefined;
    private static parseAddresses(addressObject: AddressObject | undefined, forceArray: true): MailRessource.EmailAddress[];
    private static parseAddresses(addressObject: AddressObject | undefined, forceArray: boolean): MailRessource.EmailAddress | MailRessource.EmailAddress[] | undefined;

    private static parseAddresses(addressObject?: AddressObject | AddressObject[], forceArray?: false): MailRessource.EmailAddress | MailRessource.EmailAddress[] | undefined;
    private static parseAddresses(addressObject: AddressObject | AddressObject[] | undefined, forceArray: boolean): MailRessource.EmailAddress[];

    private static parseAddresses(addressObject?: AddressObject | AddressObject[], forceArray: boolean = false) {
        if (!addressObject) return forceArray ? [] : undefined;
        
        const isArray = Array.isArray(addressObject);

        const addresses: MailRessource.EmailAddress[] = [];
        const addressArray = isArray ? addressObject : [addressObject];

        for (const addr of addressArray) {
            if (addr.address) {
                addresses.push({
                    name: addr.name,
                    address: addr.address
                });
            } else if (addr.group) {
                for (const groupAddr of addr.group) {
                    if (groupAddr.address) {
                        addresses.push({
                            name: groupAddr.name,
                            address: groupAddr.address
                        });
                    }
                }
            }
        }

        if (isArray) {
            return addresses;
        } else {
            if (forceArray) {
                return addresses;
            }
            return addresses.length > 0 ? addresses[0] : undefined;
        }

    }

    private static parseRawFlags(rawFlags: Set<string> | string[]): MailRessource.MailFlags {

        const flagsArray = Array.isArray(rawFlags) ? rawFlags : Array.from(rawFlags);

        return {
            seen: flagsArray.includes('\\Seen'),
            answered: flagsArray.includes('\\Answered'),
            flagged: flagsArray.includes('\\Flagged'),
            deleted: flagsArray.includes('\\Deleted'),
            draft: flagsArray.includes('\\Draft'),
            recent: flagsArray.includes('\\Recent'),
        };
    }

    static getRawFlags(flags: MailRessource.MailFlags): string[] {
        const rawFlags: string[] = [];
        if (flags.seen) rawFlags.push('\\Seen');
        if (flags.answered) rawFlags.push('\\Answered');
        if (flags.flagged) rawFlags.push('\\Flagged');
        if (flags.deleted) rawFlags.push('\\Deleted');
        if (flags.draft) rawFlags.push('\\Draft');
        if (flags.recent) rawFlags.push('\\Recent');
        return rawFlags;
    }


    /**
     * Parse attachments from ParsedMail
     * @param attachments - Attachments from mailparser
     * @returns Array of parsed attachments
     */
    private static parseAttachments(attachments: Attachment[]): MailRessource.MailAttachment[] {
        if (!attachments || attachments.length === 0) return [];

        return attachments.map((attachment, index) => ({
            id: index,
            filename: attachment.filename || undefined,
            contentType: attachment.mimeType,
            size: attachment.content instanceof ArrayBuffer ? attachment.content.byteLength :  attachment.content.length,
            contentId: attachment.contentId || undefined,
            contentDisposition: attachment.disposition || undefined,
        }));
    }

    /**
     * Extract a single attachment's decoded content from a raw message source.
     *
     * The message is parsed transiently in-memory to pull out exactly one
     * attachment (identified by its index/`id` in the attachments array) and its
     * bytes. Nothing is persisted or cached — the caller is expected to stream the
     * returned buffer straight to the client and let it be garbage-collected.
     *
     * @param source - Raw email source (as fetched from IMAP)
     * @param attachmentId - Index of the attachment within the parsed attachments array
     * @returns The attachment's bytes and metadata, or `null` if the index is out of range
     */
    static async getAttachmentContent(
        source: string | ArrayBuffer | Uint8Array | Blob | Buffer | ReadableStream,
        attachmentId: number
    ): Promise<MailParser.AttachmentContent | null> {
        const parsed = await PostalMime.parse(source);
        const attachment = parsed.attachments[attachmentId];
        if (!attachment) return null;

        // postal-mime hands back an ArrayBuffer/Uint8Array for binary parts and a
        // string for text parts; normalise all cases to a single Uint8Array of bytes.
        const raw = attachment.content;
        const content = typeof raw === 'string'
            ? new TextEncoder().encode(raw)
            : raw instanceof Uint8Array
                ? raw
                : new Uint8Array(raw);

        return {
            filename: attachment.filename || undefined,
            contentType: attachment.mimeType || 'application/octet-stream',
            content,
            contentId: attachment.contentId || undefined,
            contentDisposition: attachment.disposition || undefined,
        };
    }

    /**
     * Extract body content from parsed mail.
     * Note: HTML is passed through raw - sanitization happens client-side
     * using DOMPurify with the browser's native DOM parser.
     */
    private static getBody(text: string | undefined, html: string | undefined): MailRessource.MailBody {
        const body: MailRessource.MailBody = {};
        if (text) {
            body.text = text;
        }

        if (html) {
            body.html = html;
        }
        
        return body;
    }

    private static getHeadersDict(lines: HeaderLine[]): MailRessource.MailHeaders {
        const headersDict: MailRessource.MailHeaders = {};
        for (const line of lines) {
            headersDict[line.key] = line.line;
        }
        return headersDict;
    }

}

export namespace MailParser {

    /**
     * A single attachment's decoded bytes plus the metadata needed to serve it.
     * Held only transiently — never persisted or cached server-side.
     */
    export interface AttachmentContent {
        filename?: string;
        contentType: string;
        content: Uint8Array;
        contentId?: string;
        contentDisposition?: string;
    }

}


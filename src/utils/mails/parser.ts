import PostalMime, { type Header, type HeaderLine, type Attachment, type Address as AddressObject } from 'postal-mime';
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
            
            priority: this.parsePriority(parsed.headers),

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
     * Read a mail's priority from `X-Priority` (1–5, 1 = highest), falling back to
     * `Importance` / `X-MSMail-Priority`. Nodemailer writes all three for high and
     * low priority mails; other clients often write only one of them.
     */
    static parsePriority(headers: Header[]): NonNullable<MailRessource.IMail['priority']> {
        const header = (name: string) => headers.find(h => h.key.toLowerCase() === name)?.value?.trim().toLowerCase();

        const xPriority = header('x-priority');
        if (xPriority) {
            const level = parseInt(xPriority, 10);
            if (level === 1 || level === 2 || xPriority === 'high' || xPriority === 'urgent') return 'high';
            if (level === 4 || level === 5 || xPriority === 'low') return 'low';
            if (level === 3) return 'normal';
        }

        const importance = header('importance') ?? header('x-msmail-priority');
        if (importance === 'high') return 'high';
        if (importance === 'low') return 'low';
        return 'normal';
    }

    /**
     * Maps the client-facing flag names to their IMAP system flags. `\Recent` is
     * server-managed and cannot be set by clients, so it is intentionally omitted.
     */
    static readonly SETTABLE_FLAG_MAP: Readonly<Record<Exclude<keyof MailRessource.MailFlags, 'recent'>, string>> = {
        seen: '\\Seen',
        answered: '\\Answered',
        flagged: '\\Flagged',
        draft: '\\Draft',
        deleted: '\\Deleted'
    };

    /**
     * Split a partial flag update into the IMAP flags to add (`true`) and to
     * remove (`false`). Flags left `undefined` are untouched. Used for in-place
     * flag updates that must preserve the message's other flags and its UID.
     */
    static getFlagChanges(flags: Partial<MailRessource.MailFlags>): { toAdd: string[]; toRemove: string[] } {
        const toAdd: string[] = [];
        const toRemove: string[] = [];
        for (const [key, imapFlag] of Object.entries(MailParser.SETTABLE_FLAG_MAP)) {
            const value = flags[key as keyof MailRessource.MailFlags];
            if (value === true) toAdd.push(imapFlag);
            else if (value === false) toRemove.push(imapFlag);
        }
        return { toAdd, toRemove };
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
            size: this.byteLengthOf(attachment.content),
            contentId: attachment.contentId || undefined,
            contentDisposition: attachment.disposition || undefined,
        }));
    }

    /**
     * Byte length of an attachment's content, regardless of how postal-mime
     * represents it. For strings this is the UTF-8 byte count (not `.length`,
     * which counts UTF-16 code units and over-reports multi-byte characters).
     */
    private static byteLengthOf(content: ArrayBuffer | Uint8Array | string): number {
        if (typeof content === 'string') return Buffer.byteLength(content, 'utf-8');
        return content.byteLength;
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
        return attachment ? this.normalizeAttachment(attachment) : null;
    }

    /**
     * Attachment metadata of a raw message, identical to what {@link parseMail}
     * reports for the stored mail (so the `id`s match the attachment routes).
     */
    static async getAttachmentMetadata(
        source: string | ArrayBuffer | Uint8Array | Blob | Buffer | ReadableStream
    ): Promise<MailRessource.MailAttachment[]> {
        const parsed = await PostalMime.parse(source);
        return this.parseAttachments(parsed.attachments);
    }

    /** Parse all attachment bytes and metadata from one immutable MIME source. */
    static async getAttachmentContents(
        source: string | ArrayBuffer | Uint8Array | Blob | Buffer | ReadableStream
    ): Promise<MailParser.AttachmentContent[]> {
        const parsed = await PostalMime.parse(source);
        return parsed.attachments.map(attachment => this.normalizeAttachment(attachment));
    }

    /** Normalize one postal-mime attachment without touching unrelated parts. */
    private static normalizeAttachment(attachment: Attachment): MailParser.AttachmentContent {
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


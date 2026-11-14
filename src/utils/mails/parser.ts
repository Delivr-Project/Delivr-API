import PostalMime, { type Header, type HeaderLine, type Attachment, type Address as AddressObject } from 'postal-mime';
import type { MessageStructureObject } from 'imapflow';
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

    static parseRawFlags(rawFlags: Set<string> | string[]): MailRessource.MailFlags {

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

    static readonly PREVIEW_LENGTH = 256;

    /** Plain-text preview of a body (text part, else stripped HTML). */
    static getPreviewBody(body: MailRessource.MailBody): MailRessource.MailBody {
        const source = body.text ?? (body.html ? MailParser.htmlToPreviewText(body.html) : '');
        let preview = source.replace(/\s+/g, ' ').trim().slice(0, MailParser.PREVIEW_LENGTH);

        // drop a half surrogate pair at the cut
        if (/[\uD800-\uDBFF]$/.test(preview)) {
            preview = preview.slice(0, -1);
        }
        return preview ? { text: preview } : {};
    }

    /** Visible text of (possibly truncated) HTML. */
    private static htmlToPreviewText(html: string): string {
        return html
            .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, ' ')
            .replace(/<(head|style|script)\b[\s\S]*$/i, ' ') // cut off inside the block
            .replace(/<!--[\s\S]*?(-->|$)/g, ' ')
            .replace(/<[^>]*(>|$)/g, ' ')
            .replace(/&(nbsp|amp|lt|gt|quot|apos|#39|#x[0-9a-f]+|#\d+);/gi, (entity, name: string) => {
                switch (name.toLowerCase()) {
                    case 'nbsp': return ' ';
                    case 'amp': return '&';
                    case 'lt': return '<';
                    case 'gt': return '>';
                    case 'quot': return '"';
                    case 'apos':
                    case '#39': return "'";
                }
                const codePoint = name[1] === 'x' || name[1] === 'X'
                    ? parseInt(name.slice(2), 16)
                    : parseInt(name.slice(1), 10);
                return codePoint > 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : entity;
            });
    }

    /**
     * Body texts and attachments of a BODYSTRUCTURE, classified like postal-mime
     * so the attachment order (and with it the `id`s) matches a full parse.
     */
    private static readStructure(root: MessageStructureObject) {
        // postal-mime keeps quoted messages of bounce/abuse reports as attachments
        const isReport = (node: MessageStructureObject): boolean =>
            node.type === 'message/delivery-status'
            || node.type === 'message/feedback-report'
            || (node.type.startsWith('multipart/') && (node.childNodes ?? []).some(isReport));
        const inlineRfc822 = !isReport(root);

        const textNodes: MessageStructureObject[] = [];
        const attachmentNodes: MessageStructureObject[] = [];
        let hasInlineMessage = false;

        const walk = (node: MessageStructureObject) => {
            const disposition = node.disposition || undefined;

            const isInlineMessage = node.type === 'message/rfc822' && inlineRfc822 && (disposition ?? 'inline') === 'inline';
            if (isInlineMessage) hasInlineMessage = true;

            if (node.type.startsWith('multipart/') || isInlineMessage) {
                for (const child of node.childNodes ?? []) walk(child);
                return;
            }

            const isBodyText = (node.type === 'text/plain' || node.type === 'text/html') && disposition !== 'attachment';
            if (isBodyText) {
                textNodes.push(node);
            } else if (node.size) {
                attachmentNodes.push(node);
            }
        };
        walk(root);

        return { textNodes, attachmentNodes, hasInlineMessage };
    }

    private static attachmentOfNode(node: MessageStructureObject, id: number): MailRessource.MailAttachment {
        return {
            id,
            filename: node.dispositionParameters?.filename || node.parameters?.name || undefined,
            contentType: node.type,
            size: MailParser.estimateDecodedSize(node.size ?? 0, node.encoding),
            contentId: node.id || undefined,
            contentDisposition: node.disposition || undefined,
        };
    }

    /**
     * Attachments from BODYSTRUCTURE, classified like postal-mime so `id`s match.
     * Sizes are estimated for base64 parts.
     */
    static attachmentsFromStructure(root: MessageStructureObject | undefined): MailRessource.MailAttachment[] {
        if (!root) return [];
        return MailParser.readStructure(root).attachmentNodes.map((node, id) => MailParser.attachmentOfNode(node, id));
    }

    /** Mails up to this size are fetched and parsed whole. */
    static readonly FULL_SOURCE_BYTES = 512 * 1024;

    /** Leaving the attachments on the mail server has to save at least this much. */
    static readonly MIN_PARTIAL_SAVINGS_BYTES = 256 * 1024;

    /**
     * How to read a mail's content: whole, or only its text parts with the
     * attachments fetched one by one when they are asked for.
     *
     * Depends on the size and structure alone, so the mail and the attachment
     * routes always decide the same way and agree on the attachment `id`s.
     */
    static planContentFetch(size: number | undefined, root: MessageStructureObject | undefined): MailParser.ContentPlan {
        const full: MailParser.ContentPlan = { mode: 'full' };

        if (!root || size === undefined || size <= MailParser.FULL_SOURCE_BYTES) return full;
        // a single part has nothing to leave out
        if (!root.childNodes?.length) return full;

        const { textNodes, attachmentNodes, hasInlineMessage } = MailParser.readStructure(root);

        // an inline message's text belongs to the body, and its headers aren't part of the structure
        if (hasInlineMessage) return full;

        const textBytes = textNodes.reduce((sum, node) => sum + (node.size ?? 0), 0);
        if (size - textBytes < MailParser.MIN_PARTIAL_SAVINGS_BYTES) return full;

        if ([...textNodes, ...attachmentNodes].some(node => !node.part)) return full;

        const hasBoundaries = (node: MessageStructureObject): boolean =>
            !node.type.startsWith('multipart/')
            || (!!node.parameters?.boundary && (node.childNodes ?? []).every(hasBoundaries));
        if (!hasBoundaries(root)) return full;

        return {
            mode: 'partial',
            root,
            textParts: textNodes.map(node => node.part!),
            attachments: attachmentNodes.map((node, id) => ({
                ...MailParser.attachmentOfNode(node, id),
                part: node.part!,
                encoding: node.encoding || undefined
            }))
        };
    }

    /** The header block of a raw message including its closing empty line, or `null` if it is cut off. */
    static headerBlockOf(source: Buffer): Buffer | null {
        const crlf = source.indexOf('\r\n\r\n');
        const lf = source.indexOf('\n\n');

        if (crlf === -1 && lf === -1) return null;
        if (lf !== -1 && (crlf === -1 || lf < crlf)) return source.subarray(0, lf + 2);
        return source.subarray(0, crlf + 4);
    }

    /**
     * A message with the original headers and MIME tree that contains only the
     * given text parts. postal-mime builds the same body from it as from the
     * whole mail, because attachments never take part in that.
     *
     * @param headers - the original header block ({@link headerBlockOf})
     * @param textParts - undecoded part bodies by part number, as fetched from IMAP
     */
    static buildTextOnlySource(headers: Buffer, root: MessageStructureObject, textParts: Map<string, Buffer>): Buffer {
        const chunks: Buffer[] = [headers];
        const text = (value: string) => chunks.push(Buffer.from(value, 'latin1'));

        const hasText = (node: MessageStructureObject): boolean =>
            node.type.startsWith('multipart/')
                ? (node.childNodes ?? []).some(hasText)
                : !!node.part && textParts.has(node.part);

        const quote = (value: string) => `"${value.replace(/(["\\])/g, '\\$1')}"`;

        const emitChildren = (node: MessageStructureObject) => {
            const boundary = node.parameters!.boundary;

            for (const child of node.childNodes ?? []) {
                if (!hasText(child)) continue;

                text(`--${boundary}\r\n`);
                if (child.type.startsWith('multipart/')) {
                    text(`Content-Type: ${child.type}; boundary=${quote(child.parameters!.boundary!)}\r\n\r\n`);
                    emitChildren(child);
                } else {
                    // charset, format=flowed and delsp decide how the text is decoded
                    const parameters = Object.entries(child.parameters ?? {})
                        .filter(([key, value]) => /^[\w-]+$/.test(key) && /^[\x20-\x7E]*$/.test(value))
                        .map(([key, value]) => `; ${key}=${quote(value)}`)
                        .join('');

                    text(`Content-Type: ${child.type}${parameters}\r\n`);
                    if (child.encoding) text(`Content-Transfer-Encoding: ${child.encoding}\r\n`);
                    text('\r\n');
                    chunks.push(textParts.get(child.part!)!);
                }
                text('\r\n');
            }

            text(`--${boundary}--\r\n`);
        };
        emitChildren(root);

        return Buffer.concat(chunks);
    }

    /** Undo a part's Content-Transfer-Encoding; the bytes stay in their original charset. */
    static decodeTransferEncoding(raw: Buffer, encoding: string | undefined): Uint8Array {
        switch ((encoding ?? '').toLowerCase()) {
            case 'base64': return Buffer.from(raw.toString('latin1'), 'base64');
            case 'quoted-printable': return MailParser.decodeQuotedPrintable(raw);
            default: return raw;
        }
    }

    private static decodeQuotedPrintable(raw: Buffer): Buffer {
        const isHex = (byte: number | undefined) =>
            byte !== undefined && ((byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x46) || (byte >= 0x61 && byte <= 0x66));

        const decoded = Buffer.allocUnsafe(raw.length);
        let length = 0;

        for (let i = 0; i < raw.length; i++) {
            const byte = raw[i]!;

            if (byte !== 0x3D) {
                decoded[length++] = byte;
            } else if (raw[i + 1] === 0x0D && raw[i + 2] === 0x0A) {
                i += 2; // soft line break
            } else if (raw[i + 1] === 0x0A) {
                i += 1;
            } else if (isHex(raw[i + 1]) && isHex(raw[i + 2])) {
                decoded[length++] = parseInt(raw.toString('latin1', i + 1, i + 3), 16);
                i += 2;
            } else {
                decoded[length++] = byte;
            }
        }

        return decoded.subarray(0, length);
    }

    /** base64 lines are 76 chars + CRLF */
    private static estimateDecodedSize(encodedSize: number, encoding: string | undefined): number {
        if (encoding !== 'base64') return encodedSize;
        const base64Chars = encodedSize - Math.ceil(encodedSize / 78) * 2;
        return Math.max(0, Math.floor(base64Chars * 3 / 4));
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

    /** An attachment as found in the BODYSTRUCTURE, with what is needed to fetch its bytes. */
    export interface StructureAttachment extends MailRessource.MailAttachment {
        /** IMAP part number, e.g. `2` or `1.2` */
        part: string;
        /** Content-Transfer-Encoding of the part */
        encoding?: string;
    }

    export type ContentPlan =
        | { mode: 'full' }
        | {
            mode: 'partial';
            root: MessageStructureObject;
            /** part numbers of the body texts */
            textParts: string[];
            attachments: StructureAttachment[];
        };

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


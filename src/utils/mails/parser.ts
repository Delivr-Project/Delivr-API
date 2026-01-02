import { simpleParser, type ParsedMail, type Attachment, type AddressObject, type Headers as MailHeaders } from 'mailparser';
import DOMPurify, { type WindowLike } from 'dompurify';
import { JSDOM } from 'jsdom';

// Create a DOMPurify instance with JSDOM for server-side usage
const window = new JSDOM('').window;
const purify = DOMPurify(window as WindowLike);

export interface ParsedEmailAddress {
    name?: string;
    address: string;
}

export interface ParsedEmailAttachment {
    filename?: string;
    contentType: string;
    size: number;
    content: Buffer;
    contentId?: string;
    contentDisposition?: string;
}

export interface ParsedEmailResult {
    from?: ParsedEmailAddress[];
    to?: ParsedEmailAddress[];
    cc?: ParsedEmailAddress[];
    bcc?: ParsedEmailAddress[];
    subject?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string | string[];
    date?: Date;
    text?: string;
    html?: string;
    htmlSanitized?: string;
    attachments: ParsedEmailAttachment[];
    headers: MailHeaders;
}

export class MailParser {
    /**
     * Parse an email from a buffer or string
     * @param source - Email source as Buffer or string
     * @returns Parsed and sanitized email data
     */
    async parse(source: Buffer | string): Promise<ParsedEmailResult> {
        const parsed = await simpleParser(source);
        
        return {
            from: this.parseAddresses(parsed.from),
            to: this.parseAddresses(parsed.to),
            cc: this.parseAddresses(parsed.cc),
            bcc: this.parseAddresses(parsed.bcc),
            subject: parsed.subject,
            messageId: parsed.messageId,
            inReplyTo: parsed.inReplyTo,
            references: parsed.references,
            date: parsed.date,
            text: parsed.text,
            html: parsed.html || undefined,
            htmlSanitized: parsed.html ? this.sanitizeHtml(parsed.html) : undefined,
            attachments: this.parseAttachments(parsed.attachments),
            headers: parsed.headers,
        };
    }

    /**
     * Parse email addresses from ParsedMail format
     * @param addressObject - Address object from mailparser
     * @returns Array of parsed email addresses
     */
    private parseAddresses(addressObject?: AddressObject | AddressObject[]): ParsedEmailAddress[] | undefined {
        if (!addressObject) return undefined;

        const addresses: ParsedEmailAddress[] = [];
        const addressArray = Array.isArray(addressObject) ? addressObject : [addressObject];

        for (const addr of addressArray) {
            if (addr.value) {
                addresses.push(...addr.value.map(a => ({
                    name: a.name,
                    address: a.address || '',
                })));
            }
        }

        return addresses.length > 0 ? addresses : undefined;
    }

    /**
     * Parse attachments from ParsedMail
     * @param attachments - Attachments from mailparser
     * @returns Array of parsed attachments
     */
    private parseAttachments(attachments: Attachment[]): ParsedEmailAttachment[] {
        if (!attachments || attachments.length === 0) return [];

        return attachments.map(attachment => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
            content: attachment.content,
            contentId: attachment.contentId,
            contentDisposition: attachment.contentDisposition,
        }));
    }

    /**
     * Sanitize HTML content using DOMPurify
     * @param html - Raw HTML string
     * @returns Sanitized HTML string
     */
    private sanitizeHtml(html: string): string {
        return purify.sanitize(html, {
            ALLOWED_TAGS: [
                'p', 'br', 'strong', 'em', 'u', 's', 'a', 'img',
                'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
                'table', 'thead', 'tbody', 'tr', 'th', 'td',
                'div', 'span', 'hr'
            ],
            ALLOWED_ATTR: [
                'href', 'src', 'alt', 'title', 'class', 'id',
                'width', 'height', 'style', 'target', 'rel'
            ],
            ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
            KEEP_CONTENT: true,
            RETURN_TRUSTED_TYPE: false,
        });
    }

    /**
     * Extract plain text content from email
     * Prioritizes text/plain, falls back to stripped HTML
     * @param parsed - Parsed email result
     * @returns Plain text content
     */
    getPlainText(parsed: ParsedEmailResult): string {
        if (parsed.text) {
            return parsed.text;
        }

        if (parsed.htmlSanitized) {
            // Strip HTML tags to get plain text
            return parsed.htmlSanitized
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        return '';
    }

    /**
     * Check if email has attachments
     * @param parsed - Parsed email result
     * @returns True if email has attachments
     */
    hasAttachments(parsed: ParsedEmailResult): boolean {
        return parsed.attachments.length > 0;
    }

    /**
     * Get attachments by content type
     * @param parsed - Parsed email result
     * @param contentType - Content type to filter by (e.g., 'image/png')
     * @returns Filtered attachments
     */
    getAttachmentsByType(parsed: ParsedEmailResult, contentType: string): ParsedEmailAttachment[] {
        return parsed.attachments.filter(att => att.contentType === contentType);
    }

    /**
     * Get inline attachments (embedded images, etc.)
     * @param parsed - Parsed email result
     * @returns Inline attachments
     */
    getInlineAttachments(parsed: ParsedEmailResult): ParsedEmailAttachment[] {
        return parsed.attachments.filter(att => 
            att.contentDisposition === 'inline' || att.contentId
        );
    }

    /**
     * Get regular (non-inline) attachments
     * @param parsed - Parsed email result
     * @returns Regular attachments
     */
    getRegularAttachments(parsed: ParsedEmailResult): ParsedEmailAttachment[] {
        return parsed.attachments.filter(att => 
            att.contentDisposition !== 'inline' && !att.contentId
        );
    }
}

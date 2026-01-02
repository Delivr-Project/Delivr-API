import { simpleParser, type ParsedMail, type Attachment, type AddressObject, type Headers as MailHeaders, type HeaderLines } from 'mailparser';
import DOMPurify, { type WindowLike } from 'dompurify';
import { JSDOM } from 'jsdom';
import type { Stream } from 'nodemailer/lib/xoauth2';
import type { MailRessource } from './mail';

export class MailParser {

    // Create a DOMPurify instance with JSDOM for server-side usage
    protected static readonly window = new JSDOM('').window;
    protected static readonly purify = DOMPurify(MailParser.window as WindowLike);

    /**
     * Parse an email from a buffer or string
     * @param source - Email source as Buffer or string
     * @returns Parsed and sanitized email data
     */
    static async parseMail(uid: number, source: Buffer | Stream | string): Promise<MailRessource.IMail> {
        const parsed = await simpleParser(source);

        return {
            uid,
            from: this.parseAddresses(parsed.from),
            to: this.parseAddresses(parsed.to),
            cc: this.parseAddresses(parsed.cc),
            bcc: this.parseAddresses(parsed.bcc),
            subject: parsed.subject,
            inReplyTo: parsed.inReplyTo,
            references: parsed.references,
            date: parsed.date?.getTime(),
            attachments: this.parseAttachments(parsed.attachments),
            rawHeaders: this.getHeadersDict(parsed.headerLines),
            body: this.getBody(parsed.text, parsed.html)
        };
    }

    /**
     * Parse email addresses from ParsedMail format
     * @param addressObject - Address object from mailparser
     * @returns Array of parsed email addresses
     */
    private static parseAddresses(addressObject?: AddressObject | AddressObject[]): MailRessource.EmailAddress[] | undefined {
        if (!addressObject) return undefined;

        const addresses: MailRessource.EmailAddress[] = [];
        const addressArray = Array.isArray(addressObject) ? addressObject : [addressObject];

        for (const addr of addressArray) {
            if (addr.value) {
                addresses.push(...addr.value.map(a => ({
                    name: a.address ? a.name : undefined,
                    address: a.address ? a.address : a.name
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
    private static parseAttachments(attachments: Attachment[]): MailRessource.MailAttachment[] {
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

    private static getBody(text: string | undefined, html: string | false): MailRessource.MailBody | undefined {
        if (html) {
            return {
                contentType: "html",
                content: this.sanitizeHtml(html)
            };
        }
        if (text) {
            return {
                contentType: "text",
                content: text
            };
        }
        return undefined;
    }

    /**
     * Sanitize HTML content using DOMPurify
     * @param html - Raw HTML string
     * @returns Sanitized HTML string
     */
    private static sanitizeHtml(html: string): string {
        return MailParser.purify.sanitize(html, {
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

    private static getHeadersDict(lines: HeaderLines): MailRessource.MailHeaders {
        const headersDict: MailRessource.MailHeaders = {};
        for (const line of lines) {
            headersDict[line.key] = line.line;
        }
        return headersDict;
    }

}


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


    /**
     * Parse attachments from ParsedMail
     * @param attachments - Attachments from mailparser
     * @returns Array of parsed attachments
     */
    private static parseAttachments(attachments: Attachment[]): MailRessource.MailAttachment[] {
        if (!attachments || attachments.length === 0) return [];

        return attachments.map(attachment => ({
            filename: attachment.filename || undefined,
            contentType: attachment.mimeType,
            size: attachment.content instanceof ArrayBuffer ? attachment.content.byteLength :  attachment.content.length,
            // content: attachment.content,
            contentId: attachment.contentId,
            contentDisposition: attachment.disposition || undefined,
        }));
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


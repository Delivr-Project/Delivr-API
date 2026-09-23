import { InetModels } from "../../../api/utils/shared-models/inetModels";
import { createTransport, type Transporter } from "nodemailer";
import { MailRessource } from "../ressources/mail";
import { MailAccountsModel } from "../../../api/versions/v1/routes/mail-accounts/model";

export class SMTPAccount {

    protected readonly client: Transporter;

    /**
     * Use {@link SMTPAccount.fromSettings} or {@link SMTPAccount.fromConfig} to create an instance.
     */
    protected constructor(
        readonly host: string,
        readonly port: number,
        readonly username: string,
        readonly password: string,
        readonly useSSL: InetModels.Mail.Encryption
    ) {
        this.client = createTransport({
            host: this.host,
            port: this.port,
            secure: this.useSSL === InetModels.Mail.EncryptionEnum.SSL,
            requireTLS: this.useSSL === InetModels.Mail.EncryptionEnum.STARTTLS,
            auth: {
                user: this.username,
                pass: this.password
            }
        });
    }

    static fromConfig(config: SMTPAccount.ConfigOptions) {
        return new SMTPAccount(
            config.host,
            config.port,
            config.username,
            config.password,
            config.useSSL
        );
    }

    static fromSettings(config: MailAccountsModel.BASE) {
        return new SMTPAccount(
            config.smtp_host,
            config.smtp_port,
            config.smtp_username,
            config.smtp_password,
            config.smtp_encryption
        );
    }

    /**
     * Send a message from its raw RFC822 source (e.g. a stored draft).
     *
     * The source is relayed byte-for-byte, so attachments, inline parts and the
     * original MIME structure survive — none of which are recoverable from the
     * metadata-only parsed representation.
     *
     * The envelope is passed explicitly because it cannot be derived from `raw`.
     *
     * @param source - The raw message source
     * @param mail - The parsed message, used only to build the SMTP envelope
     * @returns The nodemailer result, or `null` if the message has no sender or no recipients
     */
    async sendRaw(source: Buffer | string, mail: MailRessource.IMail) {
        const sender = mail.from;
        if (!sender) {
            return null;
        }

        // Bcc recipients live in the envelope only — the header is intentionally
        // not relied upon here, as it may legitimately be absent from the source.
        const recipients = [
            ...(mail.to ?? []),
            ...(mail.cc ?? []),
            ...(mail.bcc ?? [])
        ].map(addr => addr.address);

        if (recipients.length === 0) {
            return null;
        }

        return await this.client.sendMail({
            envelope: {
                from: sender.address,
                to: recipients
            },
            raw: SMTPAccount.removeBccHeader(source)
        });
    }

    /**
     * Remove Bcc (including folded continuation lines) from an RFC822 source
     * without decoding or rewriting the MIME body. Drafts retain this header so
     * their recipients survive IMAP storage, but it must never reach recipients.
     */
    private static removeBccHeader(source: Buffer | string): Buffer | string {
        const sourceBuffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
        const crlfIndex = sourceBuffer.indexOf("\r\n\r\n");
        const lfIndex = sourceBuffer.indexOf("\n\n");

        let separatorIndex: number;
        let lineEnding: string;
        if (lfIndex >= 0 && (crlfIndex < 0 || lfIndex < crlfIndex)) {
            separatorIndex = lfIndex;
            lineEnding = "\n";
        } else if (crlfIndex >= 0) {
            separatorIndex = crlfIndex;
            lineEnding = "\r\n";
        } else {
            // Without a blank line the whole source is headers. Strip Bcc from all
            // of it rather than sending the source untouched.
            separatorIndex = sourceBuffer.length;
            lineEnding = sourceBuffer.includes("\r\n") ? "\r\n" : "\n";
        }

        // Decode headers as latin1 so the round-trip is a lossless 1:1 byte
        // mapping — a utf8 round-trip would corrupt any raw 8-bit bytes present
        // in unrelated headers. The Bcc match only relies on ASCII, so latin1 is
        // sufficient for line detection.
        const headerLines = sourceBuffer.subarray(0, separatorIndex).toString("latin1").split(/\r?\n/);
        const retainedLines: string[] = [];
        let removingBcc = false;

        for (const line of headerLines) {
            if (/^bcc\s*:/i.test(line)) {
                removingBcc = true;
                continue;
            }
            if (removingBcc && /^[ \t]/.test(line)) continue;

            removingBcc = false;
            retainedLines.push(line);
        }

        if (retainedLines.length === headerLines.length) return source;

        const sanitized = Buffer.concat([
            Buffer.from(retainedLines.join(lineEnding), "latin1"),
            sourceBuffer.subarray(separatorIndex)
        ]);
        return Buffer.isBuffer(source) ? sanitized : sanitized.toString("utf8");
    }

    /**
     * Whether a send failed because the message is larger than the SMTP server
     * accepts: nodemailer's own check against the server's advertised SIZE, or a
     * rejection with enhanced status code 5.3.4 / 5.2.3 (RFC 3463).
     */
    static isMessageTooLargeError(error: unknown): boolean {
        if (!error || typeof error !== "object") return false;

        const { code, message, response } = error as { code?: unknown; message?: unknown; response?: unknown };
        if (code === "EMESSAGE" && typeof message === "string" && message.startsWith("Message size larger than allowed")) {
            return true;
        }
        return typeof response === "string" && /^5\d\d[ -]5\.(?:3\.4|2\.3)\b/.test(response);
    }

}

export namespace SMTPAccount {

    export interface ConfigOptions {
        host: string;
        port: number;
        username: string;
        password: string;
        useSSL: InetModels.Mail.Encryption;
    }

}

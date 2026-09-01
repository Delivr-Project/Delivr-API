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

    async sendMail(mail: MailRessource.IMail) {
        const sender = mail.from;
        if (!sender) {
            return null;
        }

        const from = SMTPAccount.formatAddress(sender);

        return await this.client.sendMail({
            from,
            to: mail.to?.map(SMTPAccount.formatAddress),
            cc: mail.cc?.map(SMTPAccount.formatAddress),
            bcc: mail.bcc?.map(SMTPAccount.formatAddress),
            replyTo: mail.replyTo ? mail.replyTo.map(SMTPAccount.formatAddress): undefined,
            inReplyTo: mail.inReplyTo,
            references: Array.isArray(mail.references) ? mail.references.join(' ') : mail.references,
            subject: mail.subject,
            text: mail.body?.text,
            html: mail.body?.html,
            date: mail.date ? new Date(mail.date) : undefined
        });
    }

    /**
     * Send a message from its raw RFC822 source.
     *
     * Preferred over {@link SMTPAccount.sendMail} when the message already exists
     * (e.g. a stored draft): the source is relayed byte-for-byte, so attachments,
     * inline parts and the original MIME structure survive — none of which are
     * recoverable from the metadata-only parsed representation.
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
            raw: source
        });
    }

    protected static formatAddress(addr: MailRessource.EmailAddress) {
        return addr.name ? `"${addr.name}" <${addr.address}>` : addr.address;
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

import { InetModels } from "../../../api/utils/shared-models/inetModels";
import { createTransport, type Transporter } from "nodemailer";
import { MailRessource } from "../mail";
import { MailAccountsModel } from "../../../api/routes/mail-accounts/model";

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
        const sender = mail.from?.[0];
        if (!sender) {
            return null;
        }

        const from = SMTPAccount.formatAddress(sender);

        // Prepare text and html based on body content type
        let text: string | undefined;
        let html: string | undefined;
        
        if (mail.body) {
            if (mail.body.contentType === 'html') {
                html = mail.body.content;
            } else {
                text = mail.body.content;
            }
        }

        return await this.client.sendMail({
            from: from,
            to: mail.to?.map(SMTPAccount.formatAddress),
            cc: mail.cc?.map(SMTPAccount.formatAddress),
            bcc: mail.bcc?.map(SMTPAccount.formatAddress),
            // @todo add replyTo
            // replyTo: mail.replyTo?,
            inReplyTo: mail.inReplyTo,
            references: Array.isArray(mail.references) ? mail.references.join(' ') : mail.references,
            subject: mail.subject,
            text: text,
            html: html,
            date: mail.date ? new Date(mail.date) : undefined
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

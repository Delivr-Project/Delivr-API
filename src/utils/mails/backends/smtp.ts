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

        const from = sender.name ? `"${sender.name}" <${sender.address}>` : sender.address;
        const to = mail.to?.map(recipient => recipient.address) ?? [];
        

        return await this.client.sendMail({
            from: from,
            to: to,
        });
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

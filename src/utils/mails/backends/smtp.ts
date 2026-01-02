import { InetModels } from "../../../api/utils/shared-models/inetModels";
import { createTransport, type Transporter } from "nodemailer";

export class SMTPAccount {

    protected readonly client: Transporter;

    constructor(
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

}

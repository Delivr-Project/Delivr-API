import { ImapFlow } from "imapflow";
import { InetModels } from "../../../api/utils/shared-models/inetModels";

export class IMAPAccount {

    protected readonly client: ImapFlow;
    protected isConnected: boolean = false;

    constructor(
        readonly host: string,
        readonly port: number,
        readonly username: string,
        readonly password: string,
        readonly useSSL: InetModels.Mail.Encryption
    ) {
        this.client = new ImapFlow({
            host: this.host,
            port: this.port,
            secure: this.useSSL === InetModels.Mail.EncryptionEnum.SSL,
            doSTARTTLS: this.useSSL === InetModels.Mail.EncryptionEnum.STARTTLS,
            auth: {
                user: this.username,
                pass: this.password
            }
        });

        const thisRef = this;

        this.client.once('close', err => {
            thisRef.isConnected = false;
        });
    }

    async connect() {
        if (!this.isConnected) {
            await this.client.connect();
            this.isConnected = true;
        }
    }

    async disconnect() {
        if (this.isConnected) {
            await this.client.logout();
            this.isConnected = false;
        }
    }

    get connected() {
        return this.isConnected;
    }
    
}

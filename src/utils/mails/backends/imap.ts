import { ImapFlow, type ListResponse, type ListTreeResponse } from "imapflow";
import { InetModels } from "../../../api/utils/shared-models/inetModels";
import { MailAccountsModel } from "../../../api/routes/mail-accounts/model";
import { MailRessource } from "../mail";

export class IMAPAccount {

    protected readonly client: ImapFlow;
    protected isConnected: boolean = false;

    /**
     * Use {@link IMAPAccount.fromSettings} or {@link IMAPAccount.fromConfig} to create an instance.
     */
    protected constructor(
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

    static fromConfig(config: IMAPAccount.ConfigOptions) {
        return new IMAPAccount(
            config.host,
            config.port,
            config.username,
            config.password,
            config.useSSL
        );
    }

    static fromSettings(config: MailAccountsModel.BASE) {
        return new IMAPAccount(
            config.imap_host,
            config.imap_port,
            config.imap_username,
            config.imap_password,
            config.imap_encryption
        );
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
    
    async getMailboxes(asTree?: false): Promise<ListResponse[]>;
    async getMailboxes(asTree: true): Promise<ListTreeResponse>;
    async getMailboxes(asTree: boolean): Promise<ListResponse[] | ListTreeResponse>
    async getMailboxes(asTree = false) {
        if (asTree) {
            return await this.client.listTree();
        } else {
            return await this.client.list();
        }
    }

    async getMailboxStatus(path: string) {
        return await this.client.status(path, {
            messages: true,
            unseen: true,
            recent: true
        });
    }

    async getMails(mailbox: string, limit = 50) {
        let lock = await this.client.getMailboxLock(mailbox);
        try {
            let total = this.client.mailbox ? this.client.mailbox.exists : 0;
            if (total === 0) return [];

            let start = Math.max(1, total - limit + 1);
            return await this.client.fetchAll(`${start}:*`, {
                envelope: true,
                flags: true,
                bodyStructure: true
            });
        } finally {
            lock.release();
        }
    }

    async getMail(mailbox: string, uid: number): Promise<MailRessource.IMail | null> {
        let lock = await this.client.getMailboxLock(mailbox);
        try {
            let message = await this.client.fetchOne(uid, {
                envelope: true,
                bodyStructure: true,
                source: true
            }, { uid: true });

            if (!message) return null;

            return new MailRessource({
                uid: message.uid
            });
        } finally {
            lock.release();
        }
    }

    async markAsRead(mailbox: string, uids: number[]) {
        let lock = await this.client.getMailboxLock(mailbox);
        try {
            await this.client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
        } finally {
            lock.release();
        }
    }

    async moveToMailbox(mailbox: string, uids: number[], targetMailbox: string) {
        let lock = await this.client.getMailboxLock(mailbox);
        try {
            await this.client.messageMove(uids, targetMailbox, { uid: true });
        } finally {
            lock.release();
        }
    }

    async moveToTrash(mailbox: string, uids: number[]) {
        let lock = await this.client.getMailboxLock(mailbox);
        try {
            // Try standard trash locations
            let trashPath = '[Gmail]/Trash'; // Gmail
            try {
                await this.client.messageMove(uids, trashPath, { uid: true });
            } catch {
                // Try other common names
                await this.client.messageMove(uids, 'Trash', { uid: true });
            }
        } finally {
            lock.release();
        }
    }
}

export namespace IMAPAccount {

    export interface ConfigOptions {
        host: string;
        port: number;
        username: string;
        password: string;
        useSSL: InetModels.Mail.Encryption;
    }
}
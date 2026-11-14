import { MailAccountsModel } from "../../api/versions/v1/routes/mail-accounts/model";
import { IMAPAccount } from "./backends/imap";
import { Logger } from "../logger";

export class MailClientsCache {

    private static readonly clients: Map<number, MailClientsCache.ClientsData> = new Map();

    static getClientData(accountID: number): MailClientsCache.ClientsData | null {
        const data = this.clients.get(accountID) || null;
        if (data) {
            // keep a client that is still connecting, or parallel requests open extra connections
            if (!data.imap.connected && !data.imap.isConnecting) {
                this.clients.delete(accountID);
                this.disconnect(accountID, data);
                return null;
            }
            data.lastUsedAt = Date.now();
        }
        return data;
    }

    static createClientData(settings: MailAccountsModel.BASE): MailClientsCache.ClientsData {
        return this.clients.set(settings.id, {
            imap: IMAPAccount.fromSettings(settings),
            imapBackground: IMAPAccount.fromSettings(settings),
            lastUsedAt: Date.now()
        })
        .get(settings.id)!;
    }

    static createOrGetClientData(settings: MailAccountsModel.BASE): MailClientsCache.ClientsData {
        const existingData = this.getClientData(settings.id);
        if (existingData) {
            return existingData;
        }
        return this.createClientData(settings);
    }

    /** Never throws: a failed logout must not fail the deletion or update that dropped the client. */
    static async deleteClient(accountID: number): Promise<void> {
        const clientData = this.clients.get(accountID);
        this.clients.delete(accountID);
        if (clientData) {
            await this.disconnect(accountID, clientData);
        }
    }

    /** Closes both connections of a client; never throws. */
    private static async disconnect(accountID: number, clientData: MailClientsCache.BaseClientsData): Promise<void> {
        for (const imap of [clientData.imap, clientData.imapBackground]) {
            try {
                await imap.disconnect();
            } catch (error: any) {
                Logger.warn(`Failed to disconnect the IMAP client of mail account ${accountID}`, error.message || error);
            }
        }
    }

    /**
     * Cleans up unused mail clients that have not been used for more than 15 minutes.
     */
    static async cleanupUnusedClients() {
        const now = Date.now();
        for (const [accountID, clientData] of this.clients.entries().toArray()) {
            // 15 Minutes
            if (now - clientData.lastUsedAt > 15 * 60 * 1000) {
                this.clients.delete(accountID);
                await this.disconnect(accountID, clientData);
            }
        }
    }

    static async clearAllClients() {
        for (const [accountID, client] of this.clients.entries()) {
            await this.disconnect(accountID, client);
        }
        this.clients.clear();
    }
    
}

export namespace MailClientsCache {

    export interface BaseClientsData {
        /** the connection every request uses unless it is slow */
        imap: IMAPAccount;
        /**
         * A second connection for work that takes long (attachment downloads,
         * searches). imapflow runs one command at a time per connection, so on
         * `imap` such work would hold up the mail list. Connects on first use.
         */
        imapBackground: IMAPAccount;
    }

    export interface ClientsData extends BaseClientsData {
        lastUsedAt: number;
    }

}
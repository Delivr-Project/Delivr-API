import { IMAPAccount } from "./backends/imap";

export class MailClientsCache {

    private static readonly clients: Map<number, MailClientsCache.ClientsData> = new Map();

    static getClientData(accountID: number): MailClientsCache.ClientsData | null {
        const data = this.clients.get(accountID) || null;
        if (data) {
            if (!data.imap.connected) {
                this.clients.delete(accountID);
                return null;
            }
            data.lastUsedAt = Date.now();
        }
        return data;
    }

    static createClientData(accountID: number, data: MailClientsCache.BaseClientsData): MailClientsCache.ClientsData {
        return this.clients.set(accountID, {
            ...data,
            lastUsedAt: Date.now()
        })
        .get(accountID)!;
    }

    static createOrGetClientData(accountID: number, data: MailClientsCache.BaseClientsData): MailClientsCache.ClientsData {
        const existingData = this.getClientData(accountID);
        if (existingData) {
            return existingData;
        }
        return this.createClientData(accountID, data);
    }

    static deleteClientData(accountID: number): void {
        this.clients.delete(accountID);
    }

    /**
     * Cleans up unused mail clients that have not been used for more than 15 minutes.
     */
    static async cleanupUnusedClients() {
        const now = Date.now();
        for (const [accountID, clientData] of this.clients.entries().toArray()) {
            // 15 Minutes
            if (now - clientData.lastUsedAt > 15 * 60 * 1000) {
                await clientData.imap.disconnect();
                this.clients.delete(accountID);
            }
        }
    }

    static async clearAllClients() {
        for (const [accountID, client] of this.clients.entries()) {
            await client.imap.disconnect();
        }
        this.clients.clear();
    }
    
}

export namespace MailClientsCache {

    export interface BaseClientsData {
        imap: IMAPAccount;
    }

    export interface ClientsData extends BaseClientsData {
        lastUsedAt: number;
        imap: IMAPAccount;
    }

}
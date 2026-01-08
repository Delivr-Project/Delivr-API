import { ConfigHandler } from "../config";
import { Logger } from "../logger";
import type { IMAPAccount } from "../mails/backends/imap";
import type { SMTPAccount } from "../mails/backends/smtp";
import { ObjectCrypt } from "./objectCrypt";

export class MailCrypt {

    private static getEncryptionKey(): string {
        const config = ConfigHandler.getConfig();
        if (!config) {
            throw new Error("Config File not loaded. Cannot access encryption key.");
        }

        const encryptionKey = config.DLA_ENCRYPTION_KEY;
        if (!encryptionKey) {
            throw new Error("No encryption key set in config file (DLA_ENCRYPTION_KEY). Cannot proceed.");
        }

        if (encryptionKey.length < 32) {
            throw new Error("Encryption key must be at least 32 characters long.");
        }

        return encryptionKey;
    }

    /**
     * Encrypts SMTP connection data
     * @throws Error if encryption fails or encryption key is invalid
     */
    static encryptSMTPData(data: SMTPAccount.ConfigOptions): string | null {
        try {
            const encryptionKey = this.getEncryptionKey();
            return ObjectCrypt.encrypt(data, encryptionKey);
        } catch (error) {
            Logger.error("Failed to encrypt SMTP data:", error);
            return null;
        }
    }

    /**
     * Decrypts SMTP connection data
     * @throws Error if decryption fails or data is invalid
     */
    static decryptSMTPData(encryptedData: string): SMTPAccount.ConfigOptions | null {
        try {
            const encryptionKey = this.getEncryptionKey();
            const decryptedData = ObjectCrypt.decrypt<SMTPAccount.ConfigOptions>(encryptedData, encryptionKey);

            if (!decryptedData || typeof decryptedData !== "object") {
                throw new Error("Decrypted SMTP data is not a valid object.");
            }

            if (!decryptedData.host || !decryptedData.port || !decryptedData.username || !decryptedData.password || !decryptedData.useSSL) {
                throw new Error("Decrypted SMTP data is missing required fields.");
            }

            return decryptedData;
        } catch (error) {
            Logger.error("Failed to decrypt SMTP data:", error);
            return null;
        }
    }

    /**
     * Encrypts IMAP connection data
     * @throws Error if encryption fails or encryption key is invalid
     */
    static encryptIMAPData(data: IMAPAccount.ConfigOptions): string | null {
        try {
            const encryptionKey = this.getEncryptionKey();
            return ObjectCrypt.encrypt(data, encryptionKey);
        } catch (error) {
            Logger.error("Failed to encrypt IMAP data:", error);
            return null;
        }
    }

    /**
     * Decrypts IMAP connection data
     * @throws Error if decryption fails or data is invalid
     */
    static decryptIMAPData(encryptedData: string): IMAPAccount.ConfigOptions | null {
        try {
            const encryptionKey = this.getEncryptionKey();
            const decryptedData = ObjectCrypt.decrypt<IMAPAccount.ConfigOptions>(encryptedData, encryptionKey);

            if (!decryptedData || typeof decryptedData !== "object") {
                throw new Error("Decrypted IMAP data is not a valid object.");
            }

            if (!decryptedData.host || !decryptedData.port || !decryptedData.username || !decryptedData.password || !decryptedData.useSSL) {
                throw new Error("Decrypted IMAP data is missing required fields.");
            }

            return decryptedData;
        } catch (error) {
            Logger.error("Failed to decrypt IMAP data:", error);
            return null;
        }
    }
}
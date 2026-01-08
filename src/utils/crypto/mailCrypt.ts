import { Logger } from "../logger";
import type { IMAPAccount } from "../mails/backends/imap";
import type { SMTPAccount } from "../mails/backends/smtp";
import { ObjectEncryption } from "./objectCrypt";

export class MailAccountEncryption {

    private static encryptionKey: string | null = null;

    public static init(encryptionKey: string) {
        if (this.encryptionKey) return; // already initialized

        if (!encryptionKey || encryptionKey.length < 32) {
            throw new Error("DLA_ENCRYPTION_KEY is not set or is too short. It must be at least 32 characters long.");
        }
        this.encryptionKey = encryptionKey;
    }

    /**
     * Encrypts SMTP connection data
     * @throws Error if encryption fails or encryption key is invalid
     */
    static encryptSMTPData(data: SMTPAccount.ConfigOptions): string | null {
        try {
            if (!this.encryptionKey) {
                throw new Error("Encryption key is not initialized. Call MailAccountEncryption.init() first.");
            }
            return ObjectEncryption.encrypt(data, this.encryptionKey);
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
            if (!this.encryptionKey) {
                throw new Error("Encryption key is not initialized. Call MailAccountEncryption.init() first.");
            }
            const decryptedData = ObjectEncryption.decrypt<SMTPAccount.ConfigOptions>(encryptedData, this.encryptionKey);

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
            if (!this.encryptionKey) {
                throw new Error("Encryption key is not initialized. Call MailAccountEncryption.init() first.");
            }
            return ObjectEncryption.encrypt(data, this.encryptionKey);
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
            if (!this.encryptionKey) {
                throw new Error("Encryption key is not initialized. Call MailAccountEncryption.init() first.");
            }
            const decryptedData = ObjectEncryption.decrypt<IMAPAccount.ConfigOptions>(encryptedData, this.encryptionKey);

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
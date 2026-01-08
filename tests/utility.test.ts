import { afterAll, describe, expect, test, beforeAll } from "bun:test";
import { SMTPAccount } from "../src/utils/mails/backends/smtp";
import { InetModels } from "../src/api/utils/shared-models/inetModels";
import { ObjectEncryption } from "../src/utils/crypto/objectCrypt";
import { LCrypt } from "../src/utils/crypto/lcrypt";
import { MailAccountEncryption } from "../src/utils/crypto/mailCrypt";
import { ConfigHandler } from "../src/utils/config";

describe("Utility Tests", () => {

    test("Encryption and Decryption", async () => {
        const key = LCrypt.randomBytes(16).toString("hex");

        const originalText = SMTPAccount.fromConfig({
            host: "smtp.example.com",
            port: 587,
            username: "test@test.com",
            password: "SuperSecretPassword",
            useSSL: InetModels.Mail.EncryptionEnum.STARTTLS
        });

        const encrypted = ObjectEncryption.encrypt(originalText, key);
        const decrypted = ObjectEncryption.decrypt<SMTPAccount.ConfigOptions>(encrypted, key);

        expect(decrypted.host).toEqual(originalText.host);
        expect(decrypted.port).toEqual(originalText.port);
        expect(decrypted.username).toEqual(originalText.username);
        expect(decrypted.password).toEqual(originalText.password);
        expect(decrypted.useSSL).toEqual(originalText.useSSL);

    });

    test("Mail Account Credentials Encryption and Decryption", async () => {
        const original_stmp = SMTPAccount.fromConfig({
            host: "smtp.example.com",
            port: 587,
            username: "test@test.com",
            password: "SuperSecretPassword",
            useSSL: InetModels.Mail.EncryptionEnum.STARTTLS
        });

        expect(original_stmp).not.toBeNull();
        if (!original_stmp) return;

        const encrypted_smtp = MailAccountEncryption.encryptSMTPData(original_stmp);
        expect(encrypted_smtp).not.toBeNull();
        if (!encrypted_smtp) return;

        const decrypted_smtp = MailAccountEncryption.decryptSMTPData(encrypted_smtp!);

        expect(decrypted_smtp).not.toBeNull();
        if (!decrypted_smtp) return;

        expect(decrypted_smtp.host).toEqual(original_stmp.host);
        expect(decrypted_smtp.port).toEqual(original_stmp.port);
        expect(decrypted_smtp.username).toEqual(original_stmp.username);
        expect(decrypted_smtp.password).toEqual(original_stmp.password);
        expect(decrypted_smtp.useSSL).toEqual(original_stmp.useSSL);

    });
});
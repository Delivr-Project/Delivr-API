import { afterAll, describe, expect, test, beforeAll } from "bun:test";
import { SMTPAccount } from "../src/utils/mails/backends/smtp";
import { InetModels } from "../src/api/utils/shared-models/inetModels";
import { ObjectEncryption } from "../src/utils/crypto/objectCrypt";
import { LCrypt } from "../src/utils/crypto/lcrypt";
import { MailAccountEncryption } from "../src/utils/crypto/mailCrypt";
import { ConfigHandler } from "../src/utils/config";
import type { MailRessource } from "../src/utils/mails/ressources/mail";

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

    test("Raw SMTP sending rejects messages without an envelope", async () => {
        const smtp = SMTPAccount.fromConfig({
            host: "smtp.example.com",
            port: 587,
            username: "test@test.com",
            password: "test-password",
            useSSL: InetModels.Mail.EncryptionEnum.STARTTLS
        });
        const baseMail = {
            from: { address: "sender@example.com" },
            to: [{ address: "receiver@example.com" }],
            cc: [],
            bcc: []
        } as unknown as MailRessource.IMail;

        await expect(smtp.sendRaw("Subject: test\r\n\r\nbody", { ...baseMail, from: undefined })).resolves.toBeNull();
        await expect(smtp.sendRaw("Subject: test\r\n\r\nbody", { ...baseMail, to: [] })).resolves.toBeNull();
    });

    test("Raw SMTP sending keeps Bcc in the envelope but removes its header", async () => {
        const smtp = SMTPAccount.fromConfig({
            host: "smtp.example.com",
            port: 587,
            username: "test@test.com",
            password: "test-password",
            useSSL: InetModels.Mail.EncryptionEnum.STARTTLS
        });
        let sentOptions: any;
        (smtp as any).client.sendMail = async (options: any) => {
            sentOptions = options;
            return { messageId: "test-message-id" };
        };

        const binaryBody = Buffer.from([0, 255, 1, 254, 2]);
        const source = Buffer.concat([
            Buffer.from(
                "From: sender@example.com\r\n" +
                "To: receiver@example.com\r\n" +
                "Bcc: hidden@example.com,\r\n" +
                " another-hidden@example.com\r\n" +
                "Subject: test\r\n\r\n"
            ),
            binaryBody
        ]);
        const mail = {
            from: { address: "sender@example.com" },
            to: [{ address: "receiver@example.com" }],
            cc: [],
            bcc: [
                { address: "hidden@example.com" },
                { address: "another-hidden@example.com" }
            ]
        } as unknown as MailRessource.IMail;

        const result = await smtp.sendRaw(source, mail);

        expect(result?.messageId).toBe("test-message-id");
        expect(sentOptions.envelope).toEqual({
            from: "sender@example.com",
            to: ["receiver@example.com", "hidden@example.com", "another-hidden@example.com"]
        });
        expect(sentOptions.raw.toString("latin1")).not.toMatch(/^Bcc\s*:/mi);
        expect((sentOptions.raw as Buffer).subarray(-binaryBody.length).equals(binaryBody)).toBe(true);
    });

    test("Raw SMTP sending preserves an LF-only body containing a CRLF separator", async () => {
        const smtp = SMTPAccount.fromConfig({
            host: "smtp.example.com",
            port: 587,
            username: "test@test.com",
            password: "test-password",
            useSSL: InetModels.Mail.EncryptionEnum.STARTTLS
        });
        let sentOptions: any;
        (smtp as any).client.sendMail = async (options: any) => {
            sentOptions = options;
            return { messageId: "lf-message-id" };
        };

        const body = "prefix remains\r\n\r\nsuffix remains";
        const source = [
            "From: sender@example.com",
            "To: receiver@example.com",
            "Bcc: hidden@example.com",
            "Subject: LF message",
            "",
            body
        ].join("\n");
        const mail = {
            from: { address: "sender@example.com" },
            to: [{ address: "receiver@example.com" }],
            cc: [],
            bcc: [{ address: "hidden@example.com" }]
        } as unknown as MailRessource.IMail;

        await smtp.sendRaw(source, mail);

        expect(sentOptions.raw).not.toMatch(/^Bcc\s*:/mi);
        expect(sentOptions.raw).toContain(body);
    });
});

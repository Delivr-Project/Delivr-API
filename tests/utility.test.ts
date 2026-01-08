import { afterAll, describe, expect, test, beforeAll } from "bun:test";
import { SMTPAccount } from "../src/utils/mails/backends/smtp";
import { InetModels } from "../src/api/utils/shared-models/inetModels";
import { ObjectCrypt } from "../src/utils/crypto/objectCrypt";
import LCrypt from "../src/utils/crypto/lcrypt";

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

        const encrypted = ObjectCrypt.encrypt(originalText, key);
        const decrypted = ObjectCrypt.decrypt<SMTPAccount.ConfigOptions>(encrypted, key);

        expect(decrypted.host).toEqual(originalText.host);
        expect(decrypted.port).toEqual(originalText.port);
        expect(decrypted.username).toEqual(originalText.username);
        expect(decrypted.password).toEqual(originalText.password);
        expect(decrypted.useSSL).toEqual(originalText.useSSL);

    });

});
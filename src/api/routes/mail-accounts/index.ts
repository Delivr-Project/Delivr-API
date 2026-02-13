import { Hono } from "hono";
import { MailAccountsModel } from './model';
import { DB } from "../../../db";
import { and, eq, ne } from "drizzle-orm";
import { APIResponse } from "../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { router as mailboxesRouter } from "./mailboxes";
import { router as identitiesRouter } from "./identities";
import { router as searchRouter } from "./search";
import { AuthHandler } from "../../utils/authHandler";
import { validator } from "hono-openapi";
import { MailClientsCache } from "../../../utils/mails/mail-clients-cache";
import { MailAccountEncryption } from "../../../utils/crypto/mailCrypt";
import { Logger } from "../../../utils/logger";

export const router = new Hono().basePath('/mail-accounts');

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List Mail Accounts",
        description: "Retrieve a list of mail accounts.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.BASE],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail accounts retrieved successfully", MailAccountsModel.GetAllMailAccounts.Response)
        )
    }),

    validator("query", MailAccountsModel.GetAllMailAccounts.Query),
    
    async (c) => {

        const query = c.req.valid("query");

        const authContext = AuthHandler.AuthContext.get(c);

        const mailAccountsRaw = DB.instance().select().from(DB.Schema.mailAccounts).where(
            eq(DB.Schema.mailAccounts.owner_user_id, authContext.user_id)
        ).all();

        const mailAccounts = await Promise.all(mailAccountsRaw.map(async (account) => {

            const smtpData = MailAccountEncryption.decryptSMTPData(account.smtp_encrypted_connection_data);
            const imapData = MailAccountEncryption.decryptIMAPData(account.imap_encrypted_connection_data);

            if (!smtpData || !imapData) {
                return null as any as MailAccountsModel.GetMailAccountByID.BaseResponse;
            }

            const mailAccount = {
                id: account.id,
                created_at: account.created_at,
                display_name: account.display_name,
                is_default: account.is_default,

                smtp_host: smtpData.host,
                smtp_port: smtpData.port,
                smtp_username: smtpData.username,
                smtp_encryption: smtpData.useSSL,

                imap_host: imapData.host,
                imap_port: imapData.port,
                imap_username: imapData.username,
                imap_encryption: imapData.useSSL

            } satisfies MailAccountsModel.GetMailAccountByID.BaseResponse;

            if (query.withMailboxes) {

                const imapClient = MailClientsCache.createOrGetClientData({

                    ...mailAccount,
                    owner_user_id: account.owner_user_id,
                    imap_password: imapData.password,
                    smtp_password: smtpData.password

                }).imap;

                try {
                    await imapClient.connect();
                    const mailboxes = await imapClient.getMailboxes();

                    return {
                        ...mailAccount,
                        mailboxes: mailboxes
                    } satisfies MailAccountsModel.GetMailAccountByID.ResponseWithMailboxes;
                } catch (e) {
                    Logger.error(`Failed to retrieve mailboxes for mail account with ID ${account.id}`, e);
                    return mailAccount;
                }
            }

            return mailAccount;
            
        })) satisfies MailAccountsModel.GetMailAccountByID.Response[];

        if (mailAccounts.includes(null as any)) {
            return APIResponse.serverError(c, "Failed to decrypt one or more mail account data");
        }

        return APIResponse.success(c, "Mail accounts retrieved successfully", mailAccounts satisfies MailAccountsModel.GetAllMailAccounts.Response);
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create mail account",
        description: "Create a new mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.BASE],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Mail account created successfully", MailAccountsModel.CreateMailAccount.Response)
        )
    }),

    validator("json", MailAccountsModel.CreateMailAccount.Body),

    async (c) => {
        const body = c.req.valid("json");

        const authContext = AuthHandler.AuthContext.get(c);

        if (body.is_default) {
            // If setting this mail account as default, unset all other mail accounts for this user
            await DB.instance().update(DB.Schema.mailAccounts).set({
                is_default: false
            }).where(
                and(
                    eq(DB.Schema.mailAccounts.owner_user_id, authContext.user_id),
                    eq(DB.Schema.mailAccounts.is_default, true),
                )
            );
        }

        const encryptedSMTPData = MailAccountEncryption.encryptSMTPData({
            host: body.smtp_host,
            port: body.smtp_port,
            username: body.smtp_username,
            password: body.smtp_password,
            useSSL: body.smtp_encryption
        });

        const encryptedIMAPData = MailAccountEncryption.encryptIMAPData({
            host: body.imap_host,
            port: body.imap_port,
            username: body.imap_username,
            password: body.imap_password,
            useSSL: body.imap_encryption
        });

        if (!encryptedSMTPData || !encryptedIMAPData) {
            return APIResponse.serverError(c, "Failed to encrypt mail account data");
        }

        const result = await DB.instance().insert(DB.Schema.mailAccounts).values({
            display_name: body.display_name,
            is_default: body.is_default,
            smtp_encrypted_connection_data: encryptedSMTPData,
            imap_encrypted_connection_data: encryptedIMAPData,
            owner_user_id: authContext.user_id
        }).returning().get().id;

        return APIResponse.success(c, "Mail account created successfully", { id: result } satisfies MailAccountsModel.CreateMailAccount.Response);
    }
);

router.use("/:mailAccountID/*",

    validator("param", MailAccountsModel.MailAccountIDParams),

    async (c, next) => {
        
        const authContext = AuthHandler.AuthContext.get(c);

        // @ts-ignore
        const { mailAccountID } = c.req.valid("param") as MailAccountsModel.MailAccountIDParams;

        let encryptedMailAccount = DB.instance().select().from(DB.Schema.mailAccounts).where(
            and(
                eq(DB.Schema.mailAccounts.id, mailAccountID),
                eq(DB.Schema.mailAccounts.owner_user_id, authContext.user_id)
            )
        ).get();

        if (!encryptedMailAccount) {
            return APIResponse.notFound(c, "Mail Account with the specified ID not found");
        }

        const smtpData = MailAccountEncryption.decryptSMTPData(encryptedMailAccount.smtp_encrypted_connection_data);
        const imapData = MailAccountEncryption.decryptIMAPData(encryptedMailAccount.imap_encrypted_connection_data);

        if (!smtpData || !imapData) {
            return APIResponse.serverError(c, "Failed to decrypt mail account data");
        }

        const mailAccount = {
            id: encryptedMailAccount.id,
            created_at: encryptedMailAccount.created_at,
            display_name: encryptedMailAccount.display_name,
            owner_user_id: encryptedMailAccount.owner_user_id,
            is_default: encryptedMailAccount.is_default,

            smtp_host: smtpData.host,
            smtp_port: smtpData.port,
            smtp_username: smtpData.username,
            smtp_password: smtpData.password,
            smtp_encryption: smtpData.useSSL,

            imap_host: imapData.host,
            imap_port: imapData.port,
            imap_username: imapData.username,
            imap_password: imapData.password,
            imap_encryption: imapData.useSSL

        } satisfies MailAccountsModel.BASE;
        
        // @ts-ignore
        c.set("mailAccount", mailAccount);

        await next();
    }
);

router.get('/:mailAccountID',

    APIRouteSpec.authenticated({
        summary: "Get Mail Account info",
        description: "Retrieve information about a specific mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.BASE],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail account retrieved successfully", MailAccountsModel.GetMailAccountByID.Response),
            APIResponseSpec.notFound("Mail Account with the specified ID not found")
        )
    }),

    validator("query", MailAccountsModel.GetMailAccountByID.Query),

    async (c) => {

        const query = c.req.valid("query");

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        const mailAccountResponse = {

            id: mailAccount.id,
            created_at: mailAccount.created_at,
            display_name: mailAccount.display_name,
            is_default: mailAccount.is_default,

            smtp_host: mailAccount.smtp_host,
            smtp_port: mailAccount.smtp_port,
            smtp_username: mailAccount.smtp_username,
            smtp_encryption: mailAccount.smtp_encryption,

            imap_host: mailAccount.imap_host,
            imap_port: mailAccount.imap_port,
            imap_username: mailAccount.imap_username,
            imap_encryption: mailAccount.imap_encryption
            
        } satisfies MailAccountsModel.GetMailAccountByID.BaseResponse;

        if (query.withMailboxes) {

            const imapClient = MailClientsCache.createOrGetClientData(mailAccount).imap;

            try {
                await imapClient.connect();
                const mailboxes = await imapClient.getMailboxes();

                return APIResponse.success(c, "Mail account retrieved successfully", {
                    ...mailAccountResponse,
                    mailboxes: mailboxes
                } satisfies MailAccountsModel.GetMailAccountByID.ResponseWithMailboxes);
                
            } catch (e) {
                Logger.error(`Failed to retrieve mailboxes for mail account with ID ${mailAccount.id}`, e);
                return APIResponse.success(c, "Mail account retrieved successfully", mailAccountResponse satisfies MailAccountsModel.GetMailAccountByID.BaseResponse);
            }
        }

        return APIResponse.success(c, "Mail account retrieved successfully", mailAccountResponse satisfies MailAccountsModel.GetMailAccountByID.Response);
    }
);

router.put('/:mailAccountID',

    APIRouteSpec.authenticated({
        summary: "Update mail account info",
        description: "Update a field in a mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.BASE],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Mail account updated successfully"),
            APIResponseSpec.notFound("Mail account with the specified ID not found")
        )
    }),

    validator("json", MailAccountsModel.UpdateMailAccountInfo.Body),

    async (c) => {

        const body = c.req.valid("json");

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;


        if (body.is_default && !mailAccount.is_default) {
            // If setting this mail account as default, unset all other mail accounts for this user
            await DB.instance().update(DB.Schema.mailAccounts).set({
                is_default: false
            }).where(
                and(
                    eq(DB.Schema.mailAccounts.owner_user_id, mailAccount.owner_user_id),
                    eq(DB.Schema.mailAccounts.is_default, true),
                    ne(DB.Schema.mailAccounts.id, mailAccount.id)
                )
            );
        }

        await DB.instance().update(DB.Schema.mailAccounts).set(body).where(
            eq(DB.Schema.mailAccounts.id, mailAccount.id)
        )

        return APIResponse.successNoData(c, "Mail account updated successfully");
    }
);

router.put('/:mailAccountID/credentials',

    APIRouteSpec.authenticated({
        summary: "Update mail account credentials",
        description: "Update the SMTP/IMAP credentials for a mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.BASE],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Mail account credentials updated successfully"),
            APIResponseSpec.notFound("Mail account with the specified ID not found")
        )
    }),

    validator("json", MailAccountsModel.UpdateMailAccountCredentials.Body),

    async (c) => {

        const body = c.req.valid("json");

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        // delete cached mail client data to force re-creation with updated settings
        await MailClientsCache.deleteClient(mailAccount.id);

        const encryptedSMTPData = MailAccountEncryption.encryptSMTPData({
            host: body.smtp_host,
            port: body.smtp_port,
            username: body.smtp_username,
            password: body.smtp_password,
            useSSL: body.smtp_encryption
        });

        const encryptedIMAPData = MailAccountEncryption.encryptIMAPData({
            host: body.imap_host,
            port: body.imap_port,
            username: body.imap_username,
            password: body.imap_password,
            useSSL: body.imap_encryption
        });

        if (!encryptedSMTPData || !encryptedIMAPData) {
            return APIResponse.serverError(c, "Failed to encrypt mail account data");
        }

        await DB.instance().update(DB.Schema.mailAccounts).set({
            smtp_encrypted_connection_data: encryptedSMTPData,
            imap_encrypted_connection_data: encryptedIMAPData
        }).where(
            eq(DB.Schema.mailAccounts.id, mailAccount.id)
        )

        return APIResponse.successNoData(c, "Mail account credentials updated successfully");
    }
);

router.delete('/:mailAccountID',

    APIRouteSpec.authenticated({
        summary: "Delete mail account",
        description: "Delete a mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.BASE],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Mail account deleted successfully"),
            APIResponseSpec.notFound("Mail account with the specified ID not found")
        )
    }),

    async (c) => {

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        await MailClientsCache.deleteClient(mailAccount.id);

        // Delete all mail identities linked to this mail account
        await DB.instance().delete(DB.Schema.mailIdentities).where(
            eq(DB.Schema.mailIdentities.mail_account_id, mailAccount.id)
        );

        await DB.instance().delete(DB.Schema.mailAccounts).where(
            eq(DB.Schema.mailAccounts.id, mailAccount.id)
        );

        return APIResponse.successNoData(c, "Mail account deleted successfully");
        
    }
);

router.route("/:mailAccountID/mailboxes", mailboxesRouter);
router.route("/:mailAccountID/identities", identitiesRouter);
router.route("/:mailAccountID/search", searchRouter);
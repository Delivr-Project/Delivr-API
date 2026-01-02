import { Hono } from "hono";
import { MailsModel } from "./model";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { z } from "zod";
import { validator } from "hono-openapi";
import { MailAccountsModel } from "../model";
import { router as attachmentsRouter } from "./attachments";
import { IMAPAccount } from "../../../../utils/mails/backends/imap";
import { SMTPAccount } from "../../../../utils/mails/backends/smtp";
import MailComposer from "nodemailer/lib/mail-composer";
import { MailClientsCache } from "../../../../utils/mails/mail-clients-cache";

export const router = new Hono();

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List Mails",
        description: "Retrieve a list of mails for a specific mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mails retrieved successfully", MailsModel.GetAll.Response)
        )
    }),
    validator('query', MailsModel.GetAll.Query),
    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        const query = c.req.valid('query');

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            const mails = await imap.getMails(query.mailbox, query.limit);

            const responseMails = mails.map(mail => ({
                ...mail,
                attachments: mail.attachments.map(att => {
                    const { content, ...rest } = att;
                    return rest;
                })
            }));

            return APIResponse.success(c, "Mails retrieved successfully", responseMails satisfies MailsModel.GetAll.Response);
        } catch (e) {
            return APIResponse.serverError(c, "Failed to fetch mails");
        } finally {
            if (imap.connected) {
                await imap.disconnect();
            }
        }
    }
);

router.get('/:mailID',
    APIRouteSpec.authenticated({
        summary: "Get Mail",
        description: "Retrieve a specific mail.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail retrieved successfully", MailsModel.GetByUID.Response),
            APIResponseSpec.notFound("Mail not found")
        )
    }),
    validator('query', MailsModel.GetByUID.Query),
    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        const mailID = parseInt(c.req.param('mailID'));
        const query = c.req.valid('query');

        if (isNaN(mailID)) {
            return APIResponse.badRequest(c, "Invalid mail ID");
        }

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            const mail = await imap.getMail(query.mailbox, mailID);

            if (!mail) {
                return APIResponse.notFound(c, "Mail not found");
            }

            const responseMail = {
                ...mail,
                attachments: mail.attachments.map(att => {
                    const { content, ...rest } = att;
                    return rest;
                })
            };

            return APIResponse.success(c, "Mail retrieved successfully", responseMail satisfies MailsModel.GetByUID.Response);
        } catch (e) {
            console.error(e);
            return APIResponse.serverError(c, "Failed to fetch mail");
        } finally {
            if (imap.connected) {
                await imap.disconnect();
            }
        }
    }
);

router.post('/:mailID/send',
    APIRouteSpec.authenticated({
        summary: "Send Mail",
        description: "Send an existing mail (e.g. draft).",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail sent successfully", z.object({ messageId: z.string() })),
            APIResponseSpec.notFound("Mail not found")
        )
    }),
    validator('query', z.object({ mailbox: z.string().default("Drafts") })),
    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        const mailID = parseInt(c.req.param('mailID'));
        const query = c.req.valid('query');

        if (isNaN(mailID)) {
            return APIResponse.badRequest(c, "Invalid mail ID");
        }

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;
        const smtp = SMTPAccount.fromSettings(mailAccount);

        try {
            await imap.connect();
            const mail = await imap.getMail(query.mailbox, mailID);

            if (!mail) {
                return APIResponse.notFound(c, "Mail not found");
            }

            const info = await smtp.sendMail(mail);

            return APIResponse.success(c, "Mail sent successfully", { messageId: info.messageId });
        } catch (e) {
            console.error(e);
            return APIResponse.serverError(c, "Failed to send mail");
        } finally {
            if (imap.connected) {
                await imap.disconnect();
            }
        }
    }
);

router.post('/',
    APIRouteSpec.authenticated({
        summary: "Create Draft",
        description: "Create a new mail draft.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Draft created successfully", z.object({ success: z.boolean() }))
        )
    }),
    validator('json', MailsModel.Create.Request),
    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        const body = c.req.valid('json');

        const imap = IMAPAccount.fromSettings(mailAccount);

        try {
            const composer = new MailComposer({

            });

            const message = await composer.compile().build();

            await imap.connect();
            await imap.createMail('Drafts', message);

            return APIResponse.success(c, "Draft created successfully", { success: true });
        } catch (e) {
            console.error(e);
            return APIResponse.serverError(c, "Failed to create draft");
        } finally {
            if (imap.connected) {
                await imap.disconnect();
            }
        }
    }
);

router.post('/:mailID/move',
    APIRouteSpec.authenticated({
        summary: "Move Mail",
        description: "Move a mail to another folder.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail moved successfully", z.object({ success: z.boolean() }))
        )
    }),
    validator('query', z.object({ mailbox: z.string().default("INBOX") })),
    validator('json', MailsModel.Move.Request),
    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        const mailID = parseInt(c.req.param('mailID'));
        const query = c.req.valid('query');
        const body = c.req.valid('json');

        if (isNaN(mailID)) {
            return APIResponse.badRequest(c, "Invalid mail ID");
        }

        const imap = IMAPAccount.fromSettings(mailAccount);

        try {
            await imap.connect();
            await imap.moveToMailbox(query.mailbox, [mailID], body.targetMailbox);
            return APIResponse.success(c, "Mail moved successfully", { success: true });
        } catch (e) {
            console.error(e);
            return APIResponse.serverError(c, "Failed to move mail");
        } finally {
            if (imap.connected) {
                await imap.disconnect();
            }
        }
    }
);

router.patch('/:mailID',
    APIRouteSpec.authenticated({
        summary: "Update Mail",
        description: "Update mail flags or content (drafts).",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail updated successfully", z.object({ success: z.boolean() }))
        )
    }),
    validator('query', z.object({ mailbox: z.string().default("INBOX") })),
    validator('json', MailsModel.Patch.Request),
    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        const mailID = parseInt(c.req.param('mailID'));
        const query = c.req.valid('query');
        const body = c.req.valid('json');

        if (isNaN(mailID)) {
            return APIResponse.badRequest(c, "Invalid mail ID");
        }

        const imap = IMAPAccount.fromSettings(mailAccount);

        try {
            await imap.connect();

            // Handle flags
            if (body.flags) {
                if (body.flags.add && body.flags.add.length > 0) {
                    await imap.addFlags(query.mailbox, [mailID], body.flags.add);
                }
                if (body.flags.remove && body.flags.remove.length > 0) {
                    await imap.removeFlags(query.mailbox, [mailID], body.flags.remove);
                }
            }

            // Handle content update (only if body is provided)
            if (body.body) {
                const composer = new MailComposer({

                });

                const message = await composer.compile().build();

                await imap.createMail(query.mailbox, message);
                await imap.moveToTrash(query.mailbox, [mailID]);
            }

            return APIResponse.success(c, "Mail updated successfully", { success: true });
        } catch (e) {
            console.error(e);
            return APIResponse.serverError(c, "Failed to update mail");
        } finally {
            if (imap.connected) {
                await imap.disconnect();
            }
        }
    }
);

router.delete('/:mailID',
    APIRouteSpec.authenticated({
        summary: "Delete Mail",
        description: "Move a mail to trash (or delete).",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail deleted successfully", z.object({ success: z.boolean() }))
        )
    }),
    validator('query', z.object({ mailbox: z.string().default("INBOX") })),
    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        const mailID = parseInt(c.req.param('mailID'));
        const query = c.req.valid('query');

        if (isNaN(mailID)) {
            return APIResponse.badRequest(c, "Invalid mail ID");
        }

        const imap = IMAPAccount.fromSettings(mailAccount);

        try {
            await imap.connect();
            await imap.moveToTrash(query.mailbox, [mailID]);
            return APIResponse.success(c, "Mail deleted successfully", { success: true });
        } catch (e) {
            console.error(e);
            return APIResponse.serverError(c, "Failed to delete mail");
        } finally {
            if (imap.connected) {
                await imap.disconnect();
            }
        }
    }
);


router.route('/:mailID/attachments', attachmentsRouter);


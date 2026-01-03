import { Hono } from "hono";
import { MailsModel } from "./model";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { z } from "zod";
import { validator } from "hono-openapi";
import { MailAccountsModel } from "../model";
import { router as attachmentsRouter } from "./attachments";
import { MailClientsCache } from "../../../../utils/mails/mail-clients-cache";
import { Logger } from "../../../../utils/logger";
import { MailAccountsFoldersModel } from "../folders/model";
import { MailFolderService } from "../../../utils/services/mailFolderService";

export const router = new Hono();

router.use('/:folderPath/*',

    validator('param', MailAccountsFoldersModel.Params),

    async (c, next) => {
        // @ts-ignore
        const { folderPath } = c.req.valid('param') as MailAccountsFoldersModel.Params;
        
        return MailFolderService.folderMiddleware(c, next, folderPath);
    }
);

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

            return APIResponse.success(c, "Mails retrieved successfully", mails satisfies MailsModel.GetAll.Response);
        } catch (e) {
            Logger.error("Failed to fetch mails", e);
            return APIResponse.serverError(c, "Failed to fetch mails");
        }
    }
);

// router.post('/',

//     APIRouteSpec.authenticated({
//         summary: "Create Mail Draft",
//         description: "Create a new mail draft.",
//         tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],

//         responses: APIResponseSpec.describeWithWrongInputs(
//             APIResponseSpec.success("Draft created successfully", MailsModel.CreateDraft.Response)
//         )
//     }),

//     validator('json', MailsModel.CreateDraft.Body),

//     async (c) => {
//         // @ts-ignore
//         const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

//         const body = c.req.valid('json');

//         const imap = IMAPAccount.fromSettings(mailAccount);

//         try {

//             // @TODO handle Mail Creation properly

//             await imap.connect();
//             await imap.createMail('Drafts', message);

//             return APIResponse.success(c, "Draft created successfully", { uid: 0 });
//         } catch (e) {
//             Logger.error(e);
//             return APIResponse.serverError(c, "Failed to create draft");
//         }
//     }
// );

router.use('/:mailUID/*',

    validator('param', MailsModel.Param),

    async (c, next) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const { mailUID } = c.req.valid('param') as MailsModel.Param;
        
        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            const mail = await imap.getMail('INBOX', mailUID);

            if (!mail) {
                return APIResponse.notFound(c, "Mail with specified UID not found");
            }

            // @ts-ignore
            c.set("mailData", mail);

            await next();
        } catch (e) {
            Logger.error(`Failed to fetch mail with UID ${mailUID}`, e);
            return APIResponse.serverError(c, `Failed to fetch mail with UID ${mailUID}`);
        }
    }
);

router.get('/:mailUID',

    APIRouteSpec.authenticated({
        summary: "Get Mail",
        description: "Retrieve a specific mail.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail retrieved successfully", MailsModel.GetByUID.Response),
            APIResponseSpec.notFound("Mail with specified UID not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailData = c.get("mailData") as MailRessource.IMail;

        return APIResponse.success(c, "Mail retrieved successfully", mailData satisfies MailsModel.GetByUID.Response);
    }
);

// router.post('/:mailUID/send',

//     APIRouteSpec.authenticated({
//         summary: "Send Mail",
//         description: "Send an existing mail (e.g. draft).",
//         tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],
//         responses: APIResponseSpec.describeBasic(
//             APIResponseSpec.successNoData("Mail sent successfully"),
//             APIResponseSpec.notFound("Mail with specified UID not found")
//         )
//     }),

//     validator('query', z.object({ mailbox: z.string().default("Drafts") })),

//     async (c) => {
        
//         // @ts-ignore
//         const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
//         // @ts-ignore
//         const mailData = c.get("mailData") as MailRessource.IMail;
//         const query = c.req.valid('query');

//         const smtp = SMTPAccount.fromSettings(mailAccount);
//         const imap = IMAPAccount.fromSettings(mailAccount);

//         try {
//             await smtp.sendMail(mailData);

//             // After sending, move the mail from Drafts to Sent
//             await imap.connect();
//             await imap.moveToMailbox(query.mailbox, [mailData.uid], 'Sent');

//             return APIResponse.successNoData(c, "Mail sent successfully");
//         } catch (e) {
//             Logger.error(e);
//             return APIResponse.serverError(c, "Failed to send mail");
//         }

//     }
// );

// router.post('/:mailUID/move',

//     APIRouteSpec.authenticated({
//         summary: "Move Mail",
//         description: "Move a mail to another folder.",
//         tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],
        
//         responses: APIResponseSpec.describeBasic(
//             APIResponseSpec.successNoData("Mail moved successfully")
//         )
//     }),

//     validator('query', z.object({ sourceMailbox: z.string(), mailbox: z.string() })),

//     async (c) => {
//         // @ts-ignore
//         const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
//         // @ts-ignore
//         const mailData = c.get("mailData") as MailRessource.IMail;
//         const query = c.req.valid('query');

//         const imap = IMAPAccount.fromSettings(mailAccount);

//         try {
//             await imap.connect();
//             await imap.moveToMailbox(query.sourceMailbox, [mailData.uid], query.mailbox);

//             return APIResponse.successNoData(c, "Mail moved successfully");
//         } catch (e) {
//             Logger.error(e);
//             return APIResponse.serverError(c, "Failed to move mail");
//         }
//     }
// );

// router.put('/:mailUID',
    
//     APIRouteSpec.authenticated({
//         summary: "Update Mail",
//         description: "Update mail flags or content (drafts).",
//         tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],
//         responses: APIResponseSpec.describeBasic(
//             APIResponseSpec.success("Mail updated successfully", z.object({ success: z.boolean() }))
//         )
//     }),

//     validator('json', MailsModel.Update.Body),
    
//     async (c) => {
//         // @ts-ignore
//         const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
//         const mailUID = parseInt(c.req.param('mailUID'));
//         const query = c.req.valid('query');
//         const body = c.req.valid('json');

//         if (isNaN(mailUID)) {
//             return APIResponse.badRequest(c, "Invalid mail ID");
//         }

//         const imap = IMAPAccount.fromSettings(mailAccount);

//         try {
//             await imap.connect();

//             // Handle flags
//             if (body.flags) {
//                 if (body.flags.add && body.flags.add.length > 0) {
//                     await imap.addFlags(query.mailbox, [mailUID], body.flags.add);
//                 }
//                 if (body.flags.remove && body.flags.remove.length > 0) {
//                     await imap.removeFlags(query.mailbox, [mailUID], body.flags.remove);
//                 }
//             }

//             // Handle content update (only if body is provided)
//             if (body.body) {
//                 const composer = new MailComposer({

//                 });

//                 const message = await composer.compile().build();

//                 await imap.createMail(query.mailbox, message);
//                 await imap.moveToTrash(query.mailbox, [mailUID]);
//             }

//             return APIResponse.success(c, "Mail updated successfully", { success: true });
//         } catch (e) {
//             Logger.error(e);
//             return APIResponse.serverError(c, "Failed to update mail");
//         } finally {
//             if (imap.connected) {
//                 await imap.disconnect();
//             }
//         }
//     }
// );

// router.delete('/:mailUID',
//     APIRouteSpec.authenticated({
//         summary: "Delete Mail",
//         description: "Move a mail to trash (or delete).",
//         tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILS],
//         responses: APIResponseSpec.describeBasic(
//             APIResponseSpec.success("Mail deleted successfully", z.object({ success: z.boolean() }))
//         )
//     }),
//     validator('query', z.object({ mailbox: z.string().default("INBOX") })),
//     async (c) => {
//         // @ts-ignore
//         const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
//         const mailUID = parseInt(c.req.param('mailUID'));
//         const query = c.req.valid('query');

//         if (isNaN(mailUID)) {
//             return APIResponse.badRequest(c, "Invalid mail ID");
//         }

//         const imap = IMAPAccount.fromSettings(mailAccount);

//         try {
//             await imap.connect();
//             await imap.moveToTrash(query.mailbox, [mailUID]);
//             return APIResponse.success(c, "Mail deleted successfully", { success: true });
//         } catch (e) {
//             Logger.error(e);
//             return APIResponse.serverError(c, "Failed to delete mail");
//         } finally {
//             if (imap.connected) {
//                 await imap.disconnect();
//             }
//         }
//     }
// );


router.route('/:mailUID/attachments', attachmentsRouter);


import { Hono } from "hono";
import { validator } from "hono-openapi";
import { AttachmentsModel } from "./model";
import { APIResponse } from "../../../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../../../docs";
import { MailAccountsModel } from "../../../model";
import { MailboxesModel } from "../../model";
import { MailRessource } from "../../../../../../../../utils/mails/ressources/mail";
import { MailClientsCache } from "../../../../../../../../utils/mails/mail-clients-cache";
import { Logger } from "../../../../../../../../utils/logger";

/**
 * Build a `Content-Disposition` header value that is safe for arbitrary (incl.
 * non-ASCII) filenames, using both a sanitised ASCII `filename` fallback and the
 * RFC 5987 `filename*` form so modern clients get the exact name.
 */
function buildContentDisposition(type: "inline" | "attachment", filename?: string): string {
    if (!filename) return type;

    // ASCII fallback: strip characters that would break the quoted-string form.
    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    const encoded = encodeURIComponent(filename);

    return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export const router = new Hono();

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List Attachments",
        description: "List metadata for all attachments of a specific mail (filename, content type, size). Does not include the attachment content.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAILS_ATTACHMENTS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Attachments retrieved successfully", AttachmentsModel.GetAll.Response),
            APIResponseSpec.notFound("Mail with specified UID not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailData = c.get("mailData") as MailRessource.IMail;

        return APIResponse.success(
            c,
            "Attachments retrieved successfully",
            mailData.attachments satisfies AttachmentsModel.GetAll.Response
        );
    }
);

router.get('/:attachmentId',

    APIRouteSpec.authenticated({
        summary: "Get Attachment Content",
        description: "Stream the raw content of a single attachment. The message is fetched from IMAP and parsed on demand — the attachment is never stored or cached on the server.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.MAILBOXES_MAILS_ATTACHMENTS],

        responses: {
            200: {
                description: "Attachment content stream",
                content: {
                    "application/octet-stream": {
                        schema: { type: "string", format: "binary" }
                    }
                }
            },
            ...APIResponseSpec.notFound("Attachment with specified ID not found"),
            ...APIResponseSpec.serverError("Failed to fetch attachment")
        }
    }),

    validator('param', AttachmentsModel.Param),
    validator('query', AttachmentsModel.GetContent.Query),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        // @ts-ignore
        const mailbox = c.get("mailboxData") as MailboxesModel.BASE;
        // @ts-ignore
        const mailData = c.get("mailData") as MailRessource.IMail;

        // @ts-ignore
        const { attachmentId } = c.req.valid('param') as AttachmentsModel.Param;
        const query = c.req.valid('query');

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();
            const attachment = await imap.getAttachmentContent(mailbox.path, mailData.uid, attachmentId);

            if (!attachment) {
                return APIResponse.notFound(c, "Attachment with specified ID not found");
            }

            const disposition = query.download ? "attachment" : "inline";

            return new Response(attachment.content, {
                status: 200,
                headers: {
                    'Content-Type': attachment.contentType || 'application/octet-stream',
                    'Content-Disposition': buildContentDisposition(disposition, attachment.filename),
                    'Content-Length': String(attachment.content.byteLength),
                    // Never let the attachment be cached at any hop (browser, proxy).
                    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
                    'Pragma': 'no-cache',
                    // Prevent MIME sniffing of untrusted attachment content.
                    'X-Content-Type-Options': 'nosniff'
                }
            });
        } catch (e) {
            Logger.error(`Failed to fetch attachment ${attachmentId} for mail UID ${mailData.uid}`, e);
            return APIResponse.serverError(c, "Failed to fetch attachment");
        }
    }
);

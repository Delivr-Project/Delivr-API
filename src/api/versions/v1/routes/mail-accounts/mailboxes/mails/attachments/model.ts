import { z } from "zod";
import { MailsModel } from "../model";

export namespace AttachmentsModel {

    export const Param = z.object({
        attachmentId: z.coerce.number().min(0)
    });

    export type Param = z.infer<typeof Param>;
}

export namespace AttachmentsModel.GetAll {

    export const Response = z.array(MailsModel.MailAttachment);

    export type Response = z.infer<typeof Response>;
}

export namespace AttachmentsModel.GetContent {

    export const Query = z.object({
        download: z.coerce.boolean().default(false).describe("If true, serves the attachment with Content-Disposition: attachment (forces a download) instead of inline.")
    });

    export type Query = z.infer<typeof Query>;
}

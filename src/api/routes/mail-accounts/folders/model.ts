import Mail from "nodemailer/lib/mailer";
import { z } from "zod";

export namespace MailAccountsFoldersModel {
    
    export const Base = z.object({
        name: z.string(),
        path: z.string(),
    });

    export type Base = z.infer<typeof Base>;


    export const Params = z.object({
        folderPath: z.string().min(1).max(255),
    });

}

export namespace MailAccountsFoldersModel.GetAll {

    export const Response = z.array(MailAccountsFoldersModel.GetByName.Response);
    export type Response = z.infer<typeof Response>;

}

export namespace MailAccountsFoldersModel.GetByName {

    export const Response = MailAccountsFoldersModel.Base.omit({
        path: true,
    });

}

export namespace MailAccountsFoldersModel.Create {

    export const Body = MailAccountsFoldersModel.Base.omit({
        
    });

    export type Body = z.infer<typeof Body>;

}

import { z } from "zod";

export namespace MailsModel {
    
    // @TODO: Define mail model properties
    export const BASE = z.object({})

    export type BASE = z.infer<typeof BASE>;
}

export namespace MailsModel.GetByUID {
    
    export const Response = MailsModel.BASE;

    export type Response = z.infer<typeof Response>;
}

export namespace MailsModel.GetAll {

    export const Response = z.array(MailsModel.GetByUID.Response);

    export type Response = z.infer<typeof Response>;
}

import z, { email } from "zod";
import { UserDataPolicys } from "../../../utils/shared-models/accountData";

export namespace ResetPasswordModel.RequestReset {

    export const Body = z.object({
        email: z.email()
    });
    export type Body = z.infer<typeof Body>;
}


export namespace ResetPasswordModel.Reset {

    export const Body = z.object({
        reset_token: z.string().min(1),
        new_password: UserDataPolicys.Password
    });

    export type Body = z.infer<typeof Body>;
}
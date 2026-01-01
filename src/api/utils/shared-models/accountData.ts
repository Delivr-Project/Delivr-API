import z from "zod";

export namespace UserDataPolicys {

    export const Username = z.string()
        .min(5, 'Must be at least 5 characters')
        .max(40, 'Must be at most 40 characters')
        // .regex(/^[a-zA-Z0-9_]+$/, 'Only alphanumeric characters and underscores are allowed');
        .regex(
            /^(?!.*[.-]{2})(?!.*--)(?!.*\.\.)[a-z0-9](?:[a-z0-9._-]{3,38}[a-z0-9_])?$/,
            "Username can only contain lowercase letters, numbers, dots, underscores, and hyphens; no consecutive dots or hyphens; must start with a letter/number; can end with a letter, number, or underscore"
        )

    export type Username = z.infer<typeof Username>;

    export const Password = z.string()
        .min(8, 'Must be at least 8 characters')
        .max(50, 'Must be at most 50 characters')
        // .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
        // .regex(/[a-z]/, 'Must contain at least one lowercase letter')
        // .regex(/[0-9]/, 'Must contain at least one number')
        // .regex(/[\W_]/, 'Must contain at least one special character')
        // Combined regex to improve performance
        // .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).+$/, 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character')
        .describe("New password for the account");

    export type Password = z.infer<typeof Password>;
}

import { z } from "zod";
import { SpecialUse } from "../../../../../utils/services/specialUseService";

export namespace SpecialUseModel {

    const Entry = z.object({
        // Real IMAP path of the folder assigned to this special-use type, or null
        // for an explicit user "none" (the user wants no folder of this kind).
        path: z.string().nullable(),
        // Where the assignment came from: server flag, name heuristic, or the user.
        source: z.enum(['flag', 'guess', 'user']),
    });

    // Full resolved mapping (type -> entry). Every type is optional; a missing
    // type means no folder of that kind was detected.
    export const Mapping = z.object({
        inbox: Entry.optional(),
        drafts: Entry.optional(),
        sent: Entry.optional(),
        spam: Entry.optional(),
        trash: Entry.optional(),
        archive: Entry.optional(),
    });
    export type Mapping = z.infer<typeof Mapping>;

    export namespace Get {
        export const Response = Mapping;
        export type Response = z.infer<typeof Response>;
    }

    export namespace Update {
        // Each editable type's value: a folder path to assign it, "" (empty string)
        // for an explicit "none" (persisted; blocks re-detection), or null to clear
        // the override and fall back to auto-detection. Inbox is fixed and not editable.
        export const Body = z.object({
            drafts: z.string().nullable().optional(),
            sent: z.string().nullable().optional(),
            spam: z.string().nullable().optional(),
            trash: z.string().nullable().optional(),
            archive: z.string().nullable().optional(),
        });
        export type Body = z.infer<typeof Body>;

        export const Response = Mapping;
        export type Response = z.infer<typeof Response>;
    }

    // Compile-time guard: the model's editable keys must match the service's.
    const _editableKeys: Record<SpecialUse.EditableType, true> = {
        drafts: true, sent: true, spam: true, trash: true, archive: true,
    };
    void _editableKeys;
}

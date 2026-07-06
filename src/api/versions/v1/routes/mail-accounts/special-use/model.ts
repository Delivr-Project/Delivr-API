import { z } from "zod";
import { SpecialUse } from "../../../../../utils/services/specialUseService";

export namespace SpecialUseModel {

    const RequiredEntry = z.object({
        // Real IMAP path of the folder assigned to this special-use type, or null
        // for an explicit user "none" (only the optional archive folder).
        path: z.string(),
        // Where the assignment came from: server flag, name heuristic, or the user.
        source: z.enum(['flag', 'guess', 'user']),
    });

    const OptionalEntry = RequiredEntry.extend({
        path: z.string().nullable(),
    });

    // Full resolved mapping (type -> entry). Every type is optional; a missing
    // type means no folder of that kind was detected.
    export const Mapping = z.object({
        inbox: RequiredEntry.optional(),
        drafts: RequiredEntry.optional(),
        sent: RequiredEntry.optional(),
        spam: RequiredEntry.optional(),
        trash: RequiredEntry.optional(),
        archive: OptionalEntry.optional()
    });
    export type Mapping = z.infer<typeof Mapping>;

    export namespace Get {
        export const Response = Mapping;
        export type Response = z.infer<typeof Response>;
    }

    export namespace Update {
        // Each editable type's value: a folder path to assign it, or null to clear
        // the override and fall back to auto-detection. Only the optional archive
        // folder additionally accepts "" (empty string) for an explicit, persisted
        // "none". Inbox is fixed and not editable.
        export const Body = z.object({
            drafts: z.string().optional(),
            sent: z.string().optional(),
            spam: z.string().optional(),
            trash: z.string().optional(),
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

import { eq } from "drizzle-orm";
import { DB } from "../../../db";
import { MailboxRessource } from "../../../utils/mails/ressources/mailbox";
import type { IMAPAccount } from "../../../utils/mails/backends/imap";

/**
 * Special-use folder detection and per-account persistence.
 *
 * The backend resolves each account's special folders once (server-advertised
 * IMAP `\Flag` first, then multilingual name heuristics), stores the result and
 * reuses it, so neither it nor the client re-guesses on every request. Users can
 * override individual mappings; overrides are preserved across re-detection as
 * long as the target folder still exists.
 */
export namespace SpecialUse {

    // Inbox is fixed by the server; the rest are user-reassignable.
    export const TYPES = ['inbox', 'drafts', 'sent', 'spam', 'trash', 'archive'] as const;
    export type Type = (typeof TYPES)[number];

    export const EDITABLE_TYPES = ['drafts', 'sent', 'spam', 'trash', 'archive'] as const;
    export type EditableType = (typeof EDITABLE_TYPES)[number];

    export type Source = 'flag' | 'guess' | 'user';
    // `path` is the assigned folder, or `null` for an explicit user "none" (the
    // user actively wants no folder of this kind, e.g. no Archive). A null path
    // only ever pairs with source 'user'; detection never produces one.
    export interface Entry { path: string | null; source: Source; }
    export type Mapping = Partial<Record<Type, Entry>>;

    // The IMAP SPECIAL-USE flag stored in `specialUse` for each type.
    export const FLAG: Record<Type, string> = {
        inbox: '\\Inbox',
        drafts: '\\Drafts',
        sent: '\\Sent',
        spam: '\\Junk',
        trash: '\\Trash',
        archive: '\\Archive',
    };

    const MANAGED_FLAGS = new Set(Object.values(FLAG));

    // Leaf-name heuristics (lowercased) per type, covering common English and
    // localized folder names. Used only when the server advertises no flag.
    const NAMES: Record<Type, Set<string>> = {
        inbox: new Set(['inbox']),
        drafts: new Set([
            'drafts', 'draft', 'entwürfe', 'entwurfe', 'brouillons', 'borradores',
            'bozze', 'concepten', 'utkast', 'wersje robocze', 'rascunhos',
        ]),
        sent: new Set([
            'sent', 'sent mail', 'sent messages', 'sent items', 'gesendet',
            'gesendete', 'gesendete elemente', 'envoyés', 'envoyes', 'enviados',
            'inviati', 'verzonden', 'skickat', 'wysłane', 'itens enviados',
        ]),
        spam: new Set([
            'spam', 'junk', 'junk mail', 'junk e-mail', 'bulk mail', 'unerwünscht',
            'unerwunscht', 'pourriel', 'correo no deseado', 'posta indesiderata',
            'ongewenst',
        ]),
        trash: new Set([
            'trash', 'deleted', 'deleted items', 'deleted messages', 'bin',
            'recycle bin', 'papierkorb', 'corbeille', 'papelera', 'cestino',
            'prullenbak', 'lixeira', 'kosz', 'papperskorg',
        ]),
        archive: new Set([
            'archive', 'archives', 'all mail', 'archiv', 'archivo', 'archivio',
            'archief', 'arkiv', 'archiwum', 'arquivo',
        ]),
    };

    function leafName(mb: MailboxRessource): string {
        const delimiter = mb.delimiter || '/';
        return (mb.path.split(delimiter).pop() ?? mb.path).toLowerCase();
    }

    /** Folder paths currently assigned to any type other than `exclude`. */
    export function claimedPaths(mapping: Mapping, exclude?: Type): Set<string> {
        const taken = new Set<string>();
        for (const type of TYPES) {
            if (type === exclude) continue;
            const path = mapping[type]?.path;
            if (path) taken.add(path);
        }
        return taken;
    }

    /** Detect a single type: server flag first, then leaf-name heuristics. */
    export function detectType(type: Type, mailboxes: MailboxRessource[]): Entry | undefined {
        const byFlag = mailboxes.find((mb) => mb.specialUse === FLAG[type]);
        if (byFlag) return { path: byFlag.path, source: 'flag' };

        const names = NAMES[type];
        const byName = mailboxes.find((mb) => names.has(leafName(mb)) || names.has(mb.path.toLowerCase()));
        if (byName) return { path: byName.path, source: 'guess' };

        return undefined;
    }

    /**
     * Reconcile a mapping against the current folder list. User decisions come
     * first and own their folder (an override survives while its folder exists; an
     * explicit "none" is kept verbatim). Every remaining type is auto-detected,
     * and a folder is never assigned to two types — so neither two overrides nor a
     * re-detection can ever collide with a folder the user already claimed.
     */
    export function reconcile(existing: Mapping | null, mailboxes: MailboxRessource[]): Mapping {
        const paths = new Set(mailboxes.map((mb) => mb.path));
        const result: Mapping = {};
        const taken = new Set<string>();

        // 1. Honour the user's decisions before detecting anything.
        for (const type of TYPES) {
            const prev = existing?.[type];
            if (prev?.source !== 'user') continue;
            if (prev.path === null) {
                result[type] = prev;            // explicit "none" — detect nothing for this type
            } else if (paths.has(prev.path)) {
                result[type] = prev;            // override still points at a real folder
                taken.add(prev.path);
            }
            // else: the folder is gone — drop it and let step 2 re-detect.
        }

        // 2. Auto-detect the rest, never reusing a folder already claimed above.
        for (const type of TYPES) {
            if (result[type]) continue;
            const detected = detectType(type, mailboxes);
            if (detected && !taken.has(detected.path!)) {
                result[type] = detected;
                taken.add(detected.path!);
            }
        }

        return result;
    }

    /**
     * Rewrite each mailbox's `specialUse` to match the mapping so the client can
     * trust it verbatim. Managed flags not backed by the mapping are cleared so
     * there is never more than one folder of a given type.
     */
    export function apply(mailboxes: MailboxRessource[], mapping: Mapping): MailboxRessource[] {
        const pathToFlag = new Map<string, string>();
        for (const type of TYPES) {
            // Skip explicit "none" entries (null path) — nothing to flag.
            const path = mapping[type]?.path;
            if (path) pathToFlag.set(path, FLAG[type]);
        }

        return mailboxes.map((mb) => {
            const mapped = pathToFlag.get(mb.path);
            if (mapped) return new MailboxRessource({ ...mb, specialUse: mapped });
            if (mb.specialUse && MANAGED_FLAGS.has(mb.specialUse)) {
                return new MailboxRessource({ ...mb, specialUse: undefined });
            }
            return mb;
        });
    }
}

export class SpecialUseHandler {

    /** The stored mapping for an account, or null if none has been persisted yet. */
    static async getStored(accountId: number): Promise<SpecialUse.Mapping | null> {
        const row = await DB.instance().select().from(DB.Tables.mailAccountSpecialUse).where(
            eq(DB.Tables.mailAccountSpecialUse.mail_account_id, accountId)
        ).get();
        return row ? (row.data as SpecialUse.Mapping) : null;
    }

    private static async store(accountId: number, mapping: SpecialUse.Mapping): Promise<void> {
        await DB.instance().insert(DB.Tables.mailAccountSpecialUse).values({
            mail_account_id: accountId,
            data: mapping,
        }).onConflictDoUpdate({
            target: DB.Tables.mailAccountSpecialUse.mail_account_id,
            set: { data: mapping },
        });
    }

    /**
     * Resolve, persist and return the mapping for an account: (re)detects from the
     * current folder list while preserving valid user overrides. Single entry
     * point used by mailbox listing and after folder mutations.
     */
    static async resolve(accountId: number, mailboxes: MailboxRessource[]): Promise<SpecialUse.Mapping> {
        const existing = await this.getStored(accountId);
        const reconciled = SpecialUse.reconcile(existing, mailboxes);
        await this.store(accountId, reconciled);
        return reconciled;
    }

    /** Return the mailbox list with `specialUse` normalized against the mapping. */
    static async applyToMailboxes(accountId: number, mailboxes: MailboxRessource[]): Promise<MailboxRessource[]> {
        const mapping = await this.resolve(accountId, mailboxes);
        return SpecialUse.apply(mailboxes, mapping);
    }

    /**
     * Resolve the account's Trash folder path from the persisted special-use
     * mapping instead of re-guessing on every delete. The mapping is detected
     * once (and kept fresh after folder mutations), so the common case is a
     * single DB read with no IMAP round-trip. Only when no mapping has been
     * persisted yet do we detect from the live folder list, persist it, and use
     * that; if even detection finds nothing we fall back to the literal "Trash".
     */
    static async resolveTrashPath(accountId: number, imap: IMAPAccount): Promise<string> {
        const stored = await this.getStored(accountId);
        if (stored?.trash?.path) return stored.trash.path;

        // No usable trash mapping yet (never persisted, or an explicit "none" that
        // has no operational fallback) — detect from the live folder list and, if
        // even that finds nothing, fall back to the literal "Trash".
        const mapping = await this.resolve(accountId, await imap.getMailboxes());
        return mapping.trash?.path ?? 'Trash';
    }

    /**
     * Apply user overrides. Each editable type's value is:
     *  - a folder path → assign it (and release that folder from any other type,
     *    since a folder can only be one special type);
     *  - `""` (empty string) → an explicit "none": the type gets no folder and the
     *    choice is persisted so re-detection won't silently re-add one;
     *  - `null` → clear the override and revert this type to auto-detection.
     */
    static async setOverrides(
        accountId: number,
        mailboxes: MailboxRessource[],
        overrides: Partial<Record<SpecialUse.EditableType, string | null>>
    ): Promise<SpecialUse.Mapping> {
        const current = await this.resolve(accountId, mailboxes);
        const paths = new Set(mailboxes.map((mb) => mb.path));

        for (const type of SpecialUse.EDITABLE_TYPES) {
            if (!(type in overrides)) continue;
            const path = overrides[type];

            if (path === '') {
                // Explicit "none" — persisted so reconcile keeps it (source 'user').
                current[type] = { path: null, source: 'user' };
            } else if (path == null) {
                // Clear the override → re-detect this single type, but never reuse a
                // folder already assigned to a different type.
                const taken = SpecialUse.claimedPaths(current, type);
                const detected = SpecialUse.detectType(type, mailboxes);
                if (detected && !taken.has(detected.path!)) current[type] = detected;
                else delete current[type];
            } else if (paths.has(path)) {
                // A folder can only be one special type: release it from any other.
                for (const other of SpecialUse.TYPES) {
                    if (other !== type && current[other]?.path === path) delete current[other];
                }
                current[type] = { path, source: 'user' };
            }
            // An unknown non-empty path is ignored here (the route validates it too).
        }

        await this.store(accountId, current);
        return current;
    }

    static async deleteForAccount(accountId: number): Promise<void> {
        await DB.instance().delete(DB.Tables.mailAccountSpecialUse).where(
            eq(DB.Tables.mailAccountSpecialUse.mail_account_id, accountId)
        );
    }
}

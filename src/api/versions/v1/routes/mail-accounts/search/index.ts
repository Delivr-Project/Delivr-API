import { Hono } from "hono";
import { SearchModel } from "./model";
import { APIResponse } from "../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { validator } from "hono-openapi";
import { MailAccountsModel } from "../model";
import { MailClientsCache } from "../../../../../../utils/mails/mail-clients-cache";
import { Logger } from "../../../../../../utils/logger";
import type { IMAPAccount } from "../../../../../../utils/mails/backends/imap";
import { z } from "zod";

export const router = new Hono();

/**
 * Parse comma-separated mailbox paths from query string
 */
function parseMailboxList(value: string | undefined): string[] | undefined {
    if (!value) return undefined;
    return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Build excluded special-use folders based on query options
 */
function buildExcludedSpecialUse(query: SearchModel.CrossFolderSearch.Query): string[] {
    const excluded: string[] = [];
    
    if (!query.includeTrash) {
        excluded.push('\\Trash');
    }
    if (!query.includeSpam) {
        excluded.push('\\Junk');
    }
    if (!query.includeDrafts) {
        excluded.push('\\Drafts');
    }
    
    return excluded;
}

router.get('/',

    APIRouteSpec.authenticated({
        summary: "Quick Search",
        description: "Perform a quick text-based search across all mailboxes. This is a simplified search endpoint using a single query string that searches across subject, from, to, and body fields.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.SEARCH],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Search completed successfully", SearchModel.QuickSearch.Response)
        )
    }),

    validator('query', SearchModel.QuickSearch.Query),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        const query = c.req.valid('query');

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();

            // Build excluded special-use based on options
            const excludeSpecialUse: string[] = [];
            if (!query.includeTrash) excludeSpecialUse.push('\\Trash');
            if (!query.includeSpam) excludeSpecialUse.push('\\Junk');

            // Get all mailboxes to count and filter
            const allMailboxes = await imap.getMailboxes();
            const mailboxesToSearch = allMailboxes.filter(mb => {
                if (mb.specialUse && excludeSpecialUse.includes(mb.specialUse)) return false;
                return true;
            });

            const searchOptions: IMAPAccount.CrossFolderSearchOptions = {
                query: {
                    text: query.q
                },
                order: query.order,
                limit: query.limit,
                offset: query.offset,
                includeSpecialUse: excludeSpecialUse.length > 0 ? [] : undefined
            };

            // If we need to exclude folders, use the excludeMailboxes option
            if (excludeSpecialUse.length > 0) {
                const excludePaths = allMailboxes
                    .filter(mb => mb.specialUse && excludeSpecialUse.includes(mb.specialUse))
                    .map(mb => mb.path);
                searchOptions.excludeMailboxes = excludePaths;
            }

            const results = await imap.searchMailsAcrossFolders(searchOptions);

            // Calculate total (this is an approximation since we're paginating)
            // For accurate total, we'd need to do a count-only search first
            const total = results.length + query.offset;

            return APIResponse.success(c, "Search completed successfully", {
                total: results.length < query.limit ? results.length + query.offset : total,
                mailboxesSearched: mailboxesToSearch.length,
                results: results.map(r => ({
                    mailboxPath: r.mailboxPath,
                    mailboxName: r.mailboxName,
                    specialUse: r.specialUse,
                    mail: r.mail
                }))
            } satisfies SearchModel.QuickSearch.Response);
        } catch (e) {
            Logger.error("Failed to perform quick search", e);
            return APIResponse.serverError(c, "Failed to perform search");
        }
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Advanced Cross-Folder Search",
        description: "Perform an advanced search across multiple mailboxes with comprehensive filtering options. Supports searching by text, subject, sender, recipient, date range, flags, and attachment presence.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.SEARCH],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Search completed successfully", SearchModel.CrossFolderSearch.Response)
        )
    }),

    validator('query', SearchModel.CrossFolderSearch.Query),
    validator('json', SearchModel.CrossFolderSearch.Body),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        const query = c.req.valid('query');
        const body = c.req.valid('json');

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();

            // Build excluded special-use based on options
            const excludeSpecialUse = buildExcludedSpecialUse(query);

            // Get all mailboxes to count
            const allMailboxes = await imap.getMailboxes();
            
            // Parse mailbox filter options
            const targetMailboxes = parseMailboxList(query.mailboxes);
            const excludeMailboxes = parseMailboxList(query.excludeMailboxes) || [];

            // Add special-use exclusions
            if (excludeSpecialUse.length > 0) {
                const specialUsePaths = allMailboxes
                    .filter(mb => mb.specialUse && excludeSpecialUse.includes(mb.specialUse))
                    .map(mb => mb.path);
                excludeMailboxes.push(...specialUsePaths);
            }

            // Count mailboxes to be searched
            let mailboxesToSearchCount: number;
            if (targetMailboxes && targetMailboxes.length > 0) {
                mailboxesToSearchCount = targetMailboxes.length;
            } else {
                mailboxesToSearchCount = allMailboxes.filter(mb => !excludeMailboxes.includes(mb.path)).length;
            }

            const searchOptions: IMAPAccount.CrossFolderSearchOptions = {
                query: {
                    text: body.text,
                    subject: body.subject,
                    from: body.from,
                    to: body.to,
                    body: body.body,
                    since: body.since,
                    before: body.before,
                    hasAttachment: body.hasAttachment,
                    seen: body.seen,
                    flagged: body.flagged,
                    answered: body.answered,
                    draft: body.draft
                },
                mailboxes: targetMailboxes,
                excludeMailboxes: excludeMailboxes.length > 0 ? excludeMailboxes : undefined,
                order: query.order,
                limit: query.limit,
                offset: query.offset
            };

            const results = await imap.searchMailsAcrossFolders(searchOptions);

            return APIResponse.success(c, "Search completed successfully", {
                total: results.length < query.limit ? results.length + query.offset : results.length + query.offset,
                mailboxesSearched: mailboxesToSearchCount,
                results: results.map(r => ({
                    mailboxPath: r.mailboxPath,
                    mailboxName: r.mailboxName,
                    specialUse: r.specialUse,
                    mail: r.mail
                }))
            } satisfies SearchModel.CrossFolderSearch.Response);
        } catch (e) {
            Logger.error("Failed to perform advanced search", e);
            return APIResponse.serverError(c, "Failed to perform search");
        }
    }
);

router.post('/count',

    APIRouteSpec.authenticated({
        summary: "Count Search Results",
        description: "Get the total count of emails matching the search criteria without fetching the full results. Useful for displaying pagination info before loading results.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.SEARCH],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Count completed successfully", SearchModel.Count.Response)
        )
    }),

    validator('query', SearchModel.Count.Query),
    validator('json', SearchModel.Count.Body),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;
        const query = c.req.valid('query');
        const body = c.req.valid('json');

        const imap = MailClientsCache.createOrGetClientData(mailAccount).imap;

        try {
            await imap.connect();

            // Get count by doing search with high limit and no offset
            const excludeSpecialUse = buildExcludedSpecialUse(query as SearchModel.CrossFolderSearch.Query);
            const allMailboxes = await imap.getMailboxes();
            
            const targetMailboxes = parseMailboxList(query.mailboxes);
            const excludeMailboxes = parseMailboxList(query.excludeMailboxes) || [];

            if (excludeSpecialUse.length > 0) {
                const specialUsePaths = allMailboxes
                    .filter(mb => mb.specialUse && excludeSpecialUse.includes(mb.specialUse))
                    .map(mb => mb.path);
                excludeMailboxes.push(...specialUsePaths);
            }

            // Do a search with a very high limit to get all results for counting
            const results = await imap.searchMailsAcrossFolders({
                query: {
                    text: body.text,
                    subject: body.subject,
                    from: body.from,
                    to: body.to,
                    body: body.body,
                    since: body.since,
                    before: body.before,
                    hasAttachment: body.hasAttachment,
                    seen: body.seen,
                    flagged: body.flagged,
                    answered: body.answered,
                    draft: body.draft
                },
                mailboxes: targetMailboxes,
                excludeMailboxes: excludeMailboxes.length > 0 ? excludeMailboxes : undefined,
                limit: 10000, // High limit for counting
                offset: 0
            });

            // Calculate breakdown by mailbox
            const breakdownMap = new Map<string, { mailboxPath: string; mailboxName: string; count: number }>();
            for (const result of results) {
                const existing = breakdownMap.get(result.mailboxPath);
                if (existing) {
                    existing.count++;
                } else {
                    breakdownMap.set(result.mailboxPath, {
                        mailboxPath: result.mailboxPath,
                        mailboxName: result.mailboxName,
                        count: 1
                    });
                }
            }

            let mailboxesToSearchCount: number;
            if (targetMailboxes && targetMailboxes.length > 0) {
                mailboxesToSearchCount = targetMailboxes.length;
            } else {
                mailboxesToSearchCount = allMailboxes.filter(mb => !excludeMailboxes.includes(mb.path)).length;
            }

            return APIResponse.success(c, "Count completed successfully", {
                total: results.length,
                mailboxesSearched: mailboxesToSearchCount,
                breakdown: Array.from(breakdownMap.values()).sort((a, b) => b.count - a.count)
            } satisfies SearchModel.Count.Response);
        } catch (e) {
            Logger.error("Failed to count search results", e);
            return APIResponse.serverError(c, "Failed to count search results");
        }
    }
);


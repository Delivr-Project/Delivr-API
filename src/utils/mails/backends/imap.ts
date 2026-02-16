import { ImapFlow, type ListResponse as MailboxListResponse, type ListTreeResponse as MailboxTreeResponse, type SearchObject } from "imapflow";
import { InetModels } from "../../../api/utils/shared-models/inetModels";
import { MailAccountsModel } from "../../../api/routes/mail-accounts/model";
import { MailRessource } from "../ressources/mail";
import { MailboxRessource } from "../ressources/mailbox";
import { Logger } from "../../logger";
import { QuickSort } from "@cleverjs/utils";

export class IMAPAccount {

    protected readonly client: ImapFlow;
    protected isConnected: boolean = false;

    /**
     * Use {@link IMAPAccount.fromSettings} or {@link IMAPAccount.fromConfig} to create an instance.
     */
    protected constructor(
        readonly host: string,
        readonly port: number,
        readonly username: string,
        readonly password: string,
        readonly useSSL: InetModels.Mail.Encryption
    ) {
        this.client = new ImapFlow({
            host: this.host,
            port: this.port,
            secure: this.useSSL === InetModels.Mail.EncryptionEnum.SSL,
            doSTARTTLS: this.useSSL === InetModels.Mail.EncryptionEnum.STARTTLS,
            auth: {
                user: this.username,
                pass: this.password
            },
            logger: false
        });

        const thisRef = this;

        this.client.on('close', () => {
            thisRef.isConnected = false;
        });

        this.client.on('error', async err => {
            Logger.error(`IMAP Account Error (User: ${thisRef.username}, Host: ${thisRef.host}): ${err.message}`);
        });
    }

    static fromConfig(config: IMAPAccount.ConfigOptions) {
        return new IMAPAccount(
            config.host,
            config.port,
            config.username,
            config.password,
            config.useSSL
        );
    }

    static fromSettings(config: MailAccountsModel.BASE) {
        return new IMAPAccount(
            config.imap_host,
            config.imap_port,
            config.imap_username,
            config.imap_password,
            config.imap_encryption
        );
    }

    async connect() {
        if (!this.isConnected) {
            await this.client.connect();
            this.isConnected = true;
        }
        return this;
    }

    async disconnect() {
        if (this.isConnected) {
            await this.client.logout();
            this.isConnected = false;
        }
    }

    get connected() {
        return this.isConnected;
    }
    
    async getMailboxes(asTree?: false): Promise<MailboxRessource[]>;
    async getMailboxes(asTree: true): Promise<MailboxTreeResponse>;
    async getMailboxes(asTree: boolean): Promise<MailboxRessource[] | MailboxTreeResponse>
    async getMailboxes(asTree = false) {
        if (asTree) {
            return await this.client.listTree({
                statusQuery: {
                    messages: true,
                    unseen: true,
                    recent: true
                }
            });
        } else {
            return MailboxRessource.fromIMAPMailboxes(await this.client.list({
                statusQuery: {
                    messages: true,
                    unseen: true,
                    recent: true
                }
            }));
        }
    }

    async getMailbox(path: string): Promise<MailboxRessource | null> {
        const mailboxes = await this.client.list();
        const mailbox = mailboxes.find(mb => mb.path === path);
        if (!mailbox) return null;
        return MailboxRessource.fromIMAPMailbox(mailbox);
    }

    async getMailboxStatus(path: string): Promise<MailboxRessource.MailboxStatus | null> {
        try {
            const raw_status = await this.client.status(path, {
                messages: true,
                unseen: true,
                recent: true
            });
            if (!raw_status || !raw_status.messages || !raw_status.unseen || !raw_status.recent) {
                return null;
            }
            return {
                messages: raw_status.messages,
                unseen: raw_status.unseen,
                recent: raw_status.recent
            };
        } catch (err) {
            return null;
        }
    }

    async createMailbox(path: string) {
        const result = await this.client.mailboxCreate(path);
        if (path !== result.path || !result.created) {
            return false;
        }
    }

    async renameMailbox(oldPath: string, newPath: string) {
        const result = await this.client.mailboxRename(oldPath, newPath);
        if (oldPath !== result.path || newPath !== result.newPath) {
            return false;
        }
        return true;
    }

    async deleteMailbox(path: string) {
        const result = await this.client.mailboxDelete(path);
        if (path !== result.path) {
            return false;
        }
        return true;
    }

    async getMails(mailbox: string, options: IMAPAccount.GetMailsOptions = {}): Promise<MailRessource[]> {
        const { order = 'newest', limit = 50, offset = 0, searchString } = options;
        
        let lock = await this.client.getMailboxLock(mailbox);
        try {
            let total = this.client.mailbox ? this.client.mailbox.exists : 0;
            if (total === 0) return [];

            let uids: number[];

            // If searchString is provided, use IMAP SEARCH
            if (searchString) {
                const searchResults = await this.client.search({
                    or: [
                        { subject: searchString },
                        { from: searchString },
                        { to: searchString },
                        { body: searchString }
                    ]
                }, { uid: true });
                uids = searchResults as number[];
            } else {
                // Get all message sequence numbers
                const allMessages = await this.client.search({ all: true }, { uid: true });
                uids = allMessages as number[];
            }

            if (uids.length === 0) return [];

            // Sort UIDs based on order
            if (order === 'newest') {
                QuickSort.sort(uids, (a, b) => b - a);
            } else {
                QuickSort.sort(uids, (a, b) => a - b);
            }

            // Apply offset and limit
            const paginatedUids = uids.slice(offset, offset + limit);
            if (paginatedUids.length === 0) return [];

            const rawMails = await this.client.fetchAll(paginatedUids.join(','), {
                envelope: true,
                bodyStructure: true,
                source: true,
                flags: true
            }, { uid: true });

            const mails = await MailRessource.fromIMAPMessages(rawMails);

            // Sort the results to maintain order after fetch
            if (order === 'newest') {
                QuickSort.sort(mails, (a, b) => b.uid - a.uid);
            } else {
                QuickSort.sort(mails, (a, b) => a.uid - b.uid);
            }

            return mails;
        } finally {
            lock.release();
        }
    }

    async createMail(mailbox: string, content: string | Buffer, flags: string[] = ['\\Draft']) {
        let lock = await this.client.getMailboxLock(mailbox);
        try {
            await this.client.append(mailbox, content, flags);
        } finally {
            lock.release();
        }
    }

    // async getMail(mailbox: string, uid: number): Promise<MailRessource.IMail | null> {
    async getMail(mailbox: string, uid: number) {
        let lock = await this.client.getMailboxLock(mailbox);
        try {
            let message = await this.client.fetchOne(uid, {
                envelope: true,
                bodyStructure: true,
                source: true,
                flags: true
            }, { uid: true });

            if (!message) return null;
            return await MailRessource.fromIMAPMessage(message);
        } finally {
            lock.release();
        }
    }

    async markAsRead(mailbox: string, uids: number[]) {
        let lock = await this.client.getMailboxLock(mailbox);
        try {
            await this.client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
        } finally {
            lock.release();
        }
    }

    async addFlags(mailbox: string, uids: number[], flags: string[]) {
        let lock = await this.client.getMailboxLock(mailbox);
        try {
            await this.client.messageFlagsAdd(uids, flags, { uid: true });
        } finally {
            lock.release();
        }
    }

    async removeFlags(mailbox: string, uids: number[], flags: string[]) {
        let lock = await this.client.getMailboxLock(mailbox);
        try {
            await this.client.messageFlagsRemove(uids, flags, { uid: true });
        } finally {
            lock.release();
        }
    }

    async moveToMailbox(mailbox: string, uids: number[], targetMailbox: string) {
        let lock = await this.client.getMailboxLock(mailbox);
        try {
            await this.client.messageMove(uids, targetMailbox, { uid: true });
        } finally {
            lock.release();
        }
    }

    async moveToTrash(mailbox: string, uids: number[]) {
        let lock = await this.client.getMailboxLock(mailbox);
        try {
            // Try standard trash locations
            let trashPath = '[Gmail]/Trash'; // Gmail
            try {
                await this.client.messageMove(uids, trashPath, { uid: true });
            } catch {
                // Try other common names
                await this.client.messageMove(uids, 'Trash', { uid: true });
            }
        } finally {
            lock.release();
        }
    }

    /**
     * Search for mails across all mailboxes or specified mailboxes
     * @param options - Search options including query parameters and folder filters
     * @returns Array of search results with mailbox path information
     */
    async searchMailsAcrossFolders(options: IMAPAccount.CrossFolderSearchOptions): Promise<IMAPAccount.CrossFolderSearchResult[]> {
        const { 
            query, 
            mailboxes: targetMailboxes,
            excludeMailboxes = [],
            includeSpecialUse = ['\\Sent', '\\Drafts', '\\Trash', '\\Junk', '\\Archive'],
            order = 'newest',
            limit = 50,
            offset = 0
        } = options;

        // Get all mailboxes if not specified
        let mailboxesToSearch: MailboxListResponse[];
        const allMailboxes = await this.client.list();
        
        if (targetMailboxes && targetMailboxes.length > 0) {
            mailboxesToSearch = allMailboxes.filter(mb => targetMailboxes.includes(mb.path));
        } else {
            // Exclude specified mailboxes and optionally special-use folders
            mailboxesToSearch = allMailboxes.filter(mb => {
                if (excludeMailboxes.includes(mb.path)) return false;
                // If includeSpecialUse is empty, exclude special-use folders
                if (includeSpecialUse.length === 0 && mb.specialUse) return false;
                return true;
            });
        }

        const allResults: IMAPAccount.CrossFolderSearchResult[] = [];

        // Build IMAP search criteria
        const buildSearchCriteria = (): SearchObject => {
            const criteria: SearchObject = {};

            if (query.text) {
                // Full-text search across subject, from, to, and body
                
                criteria.or = [
                    { subject: query.text },
                    { from: query.text },
                    { to: query.text },
                    { body: query.text }
                ];
            }

            if (query.subject) {
                criteria.subject = query.subject;
            }

            if (query.from) {
                criteria.from = query.from;
            }

            if (query.to) {
                criteria.to = query.to;
            }

            if (query.body) {
                criteria.body = query.body;
            }

            if (query.since) {
                criteria.since = new Date(query.since);
            }

            if (query.before) {
                criteria.before = new Date(query.before);
            }

            if (query.hasAttachment !== undefined) {
                // IMAP doesn't have a direct "has attachment" flag, but we can filter later
                // For now, we'll handle this post-fetch
            }

            // Flag-based search
            if (query.seen !== undefined) {
                criteria.seen = query.seen;
            }

            if (query.flagged !== undefined) {
                criteria.flagged = query.flagged;
            }

            if (query.answered !== undefined) {
                criteria.answered = query.answered;
            }

            if (query.draft !== undefined) {
                criteria.draft = query.draft;
            }

            if (criteria.or && criteria.or.length === 0) {
                delete criteria.or;
            }

            return criteria;
        };

        const searchCriteria = buildSearchCriteria();

        // Search each mailbox
        for (const mailbox of mailboxesToSearch) {
            let lock;
            try {
                lock = await this.client.getMailboxLock(mailbox.path);
                
                const total = this.client.mailbox ? this.client.mailbox.exists : 0;
                if (total === 0) {
                    lock.release();
                    continue;
                }

                const searchResults = await this.client.search(searchCriteria, { uid: true });
                
                // Ensure searchResults is an array (might be empty or non-array in edge cases)
                const uids: number[] = Array.isArray(searchResults) ? searchResults : [];

                if (uids.length === 0) {
                    lock.release();
                    continue;
                }

                // Fetch mail details for matched UIDs
                const rawMails = await this.client.fetchAll(uids.join(','), {
                    envelope: true,
                    bodyStructure: true,
                    source: true,
                    flags: true
                }, { uid: true });

                let mails = await MailRessource.fromIMAPMessages(rawMails);

                // Post-fetch filtering for attachment
                if (query.hasAttachment !== undefined) {
                    mails = mails.filter(mail => 
                        query.hasAttachment ? mail.attachments.length > 0 : mail.attachments.length === 0
                    );
                }

                // Add mailbox path to results
                for (const mail of mails) {
                    allResults.push({
                        mailboxPath: mailbox.path,
                        mailboxName: mailbox.name,
                        specialUse: mailbox.specialUse,
                        mail
                    });
                }

                lock.release();
            } catch (e) {
                if (lock) lock.release();
                Logger.error(`Failed to search mailbox ${mailbox.path}`, e);
                // Continue with other mailboxes
            }
        }

        // Sort all results by date
        // allResults.sort((a, b) => {
        //     const dateA = a.mail.date || 0;
        //     const dateB = b.mail.date || 0;
        //     return order === 'newest' ? dateB - dateA : dateA - dateB;
        // });
        QuickSort.sort(allResults, (a, b) => {
            const dateA = a.mail.date ? a.mail.date : 0;
            const dateB = b.mail.date ? b.mail.date : 0;
            return order === 'newest' ? dateB - dateA : dateA - dateB;
        });

        // Apply offset and limit across all results
        return allResults.slice(offset, offset + limit);
    }
}

export namespace IMAPAccount {

    export interface ConfigOptions {
        host: string;
        port: number;
        username: string;
        password: string;
        useSSL: InetModels.Mail.Encryption;
    }

    export interface GetMailsOptions {
        order?: 'newest' | 'oldest';
        limit?: number;
        offset?: number;
        searchString?: string;
    }

    export interface SearchQuery {
        /** Full-text search across subject, from, to, and body */
        text?: string;
        /** Search in subject field */
        subject?: string;
        /** Search in from field */
        from?: string;
        /** Search in to field */
        to?: string;
        /** Search in body content */
        body?: string;
        /** Messages since this date (Unix timestamp in ms) */
        since?: number;
        /** Messages before this date (Unix timestamp in ms) */
        before?: number;
        /** Filter by attachment presence */
        hasAttachment?: boolean;
        /** Filter by seen/read status */
        seen?: boolean;
        /** Filter by flagged/starred status */
        flagged?: boolean;
        /** Filter by answered status */
        answered?: boolean;
        /** Filter by draft status */
        draft?: boolean;
    }

    export interface CrossFolderSearchOptions {
        /** Search query parameters */
        query: SearchQuery;
        /** Specific mailboxes to search (searches all if not specified) */
        mailboxes?: string[];
        /** Mailboxes to exclude from search */
        excludeMailboxes?: string[];
        /** Which special-use folders to include (default: all) */
        includeSpecialUse?: string[];
        /** Sort order by date */
        order?: 'newest' | 'oldest';
        /** Maximum number of results */
        limit?: number;
        /** Offset for pagination */
        offset?: number;
    }

    export interface CrossFolderSearchResult {
        /** Path of the mailbox containing this mail */
        mailboxPath: string;
        /** Name of the mailbox */
        mailboxName: string;
        /** Special use flag of the mailbox, if any */
        specialUse?: string;
        /** The mail data */
        mail: MailRessource;
    }
}
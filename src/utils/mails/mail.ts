
export class MailRessource implements MailRessource.IMail {

    readonly uid: number;
    readonly contentType: MailRessource.ContentTypes;

    constructor(data: MailRessource.IMail) {
        this.uid = data.uid;
        this.contentType = data.contentType;
    }

}

export namespace MailRessource {

    export interface IMail {
        uid: number;
        rawHeaders: IMailHeaders;
        body: IMailBody;
    }

    export interface IMailHeaders {
        [key: string]: string;
    }

    export interface IMailBody {
        contentType: ContentTypes;
    }

    export type ContentTypes = 'text/plain' | 'text/html' | 'raw';

    export interface EmailAddress {
        name?: string;
        address: string;
    }

}
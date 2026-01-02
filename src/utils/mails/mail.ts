
export class MailRessource implements MailRessource.IMail {

    readonly uid: number;
    readonly headers: MailRessource.IMailHeaders;
    readonly body: MailRessource.IMailBody;

    constructor(data: MailRessource.IMail) {
        this.uid = data.uid;
        this.headers = data.headers;
        this.body = data.body;
    }

}

export namespace MailRessource {

    export interface IMail {
        uid: number;
        headers: IMailHeaders;
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
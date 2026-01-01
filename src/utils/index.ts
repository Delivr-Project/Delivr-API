import { randomBytes as crypto_randomBytes } from 'crypto';
import { mkdir, mkdirSync } from 'fs';

export class Utils {

    static getRandomU32() {

        const timeComponent = Date.now() % 0x100000000;
        const randomComponent = crypto_randomBytes(4).readUInt32BE(0);

        return (timeComponent + randomComponent) % 0x100000000;
    }

    static splitNTimes(str: string, delim: string, count: number) {
        const parts = str.split(delim);
        const tail = parts.slice(count).join(delim);
        const result = parts.slice(0,count);
        if (tail) result.push(tail);
        return result;
    }

    static splitNTimesReverse(str: string, delim: string, count: number) {
        const parts = str.split(delim);
        const head = parts.slice(0, parts.length - count).join(delim);
        const result = parts.slice(parts.length - count);
        if (head) result.unshift(head);
        return result;
    }

    static mergeObjects<T extends object[]>(...objects: T): Utils.MergeArray<T> {
        return Object.assign({}, ...objects) as Utils.MergeArray<T>;
    }

    static sleep(ms: number) {
        return new Promise<void>(resolve => setTimeout(() => resolve(), ms));
    }


    static ensureDirectoryExists(path: string) {
        try {
            mkdirSync(path, { recursive: true });
        } catch (err) {
            // ignore
        }
    }

}

export namespace Utils {

    export type MergeArray<T extends object[]> =
        T extends [infer First, ...infer Rest]
            ? First & MergeArray<Rest extends object[] ? Rest : []>
            : {};

}
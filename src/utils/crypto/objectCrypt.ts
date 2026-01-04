import { Uint } from "low-level";
import LCrypt from "./lcrypt";

export class ObjectCrypt {

    static encrypt<T extends object>(obj: T, key: string): Uint {
        const keyHash = LCrypt.sha256(Uint.from(key, "utf8"));
        const jsonString = JSON.stringify(obj);
        const data = Uint.from(jsonString, "utf8");

        return LCrypt.encryptData(data, keyHash);
    }

}
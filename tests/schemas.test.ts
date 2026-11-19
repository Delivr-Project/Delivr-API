import { describe, expect, test } from "bun:test";
import { UserDataPolicys } from "../src/api/utils/shared-models/accountData";
import { z } from "zod";
import { ApiHelperModels } from "../src/api/utils/shared-models/api-helper-models";


describe("User Account Policy Schema Testing", () => {

    test("Username validation", async () => {
        
        const invalidUsernames = [
            "aa", // Too short
            "thisusernameiswaytoolongtobevalidbecauseitexceedsthemaximumlength", // Too long
            "invalid_username!", // Invalid character !
            "-invalidstart", // Starts with invalid character
            "invalidend-", // Ends with invalid character
            "a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1x", // Too long (41 characters)
        ];

        for (const username of invalidUsernames) {
            expect(UserDataPolicys.Username.safeParse(username)).toEqual({ success: false, error: expect.anything() });
        }

        const validUsernames = [
            "valid-username",
            "valid.username",
            "valid_username",
            "validusername123_",
            "12345",
            "a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1",
        ];

        for (const username of validUsernames) {
            // console.log(`Testing valid username: ${username}`);
            expect(UserDataPolicys.Username.safeParse(username)).toEqual({ success: true, data: expect.anything() });
        }

    });

    test("Password validation", async () => {
        
        const invalidPasswords = [
            "short", // Too short
            "alllowercase1!", // No uppercase letter
            "ALLUPPERCASE1!", // No lowercase letter
            "NoNumbers!", // No number
            "NoSpecialChar1", // No special character
            "ThisPasswordIsWayTooLongToBeConsideredValidBecauseItExceedsTheMaximumAllowedLength123!@#", // Too long
        ];

        for (const password of invalidPasswords) {
            expect(UserDataPolicys.Password.safeParse(password)).toEqual({ success: false, error: expect.anything() });
        }

        const validPasswords = [
            "ValidPass1!",
            "Another$Good2",
            "Str0ng&P@ssword",
            "Complex#1234",
            "A1b2C3d4!",
        ];

        for (const password of validPasswords) {
            expect(UserDataPolicys.Password.safeParse(password)).toEqual({ success: true, data: expect.anything() });
        }

    });
    
});

describe("Query boolean schema", () => {

    const optional = ApiHelperModels.queryBoolean(z.boolean().optional());
    const withDefault = ApiHelperModels.queryBoolean(z.boolean().default(true));

    test("reads true/false/1/0 and real booleans", () => {
        expect(optional.parse("true")).toBe(true);
        expect(optional.parse("false")).toBe(false);
        expect(optional.parse("1")).toBe(true);
        expect(optional.parse("0")).toBe(false);
        expect(optional.parse(true)).toBe(true);
        expect(optional.parse(false)).toBe(false);
    });

    test("keeps optional and default", () => {
        expect(optional.parse(undefined)).toBeUndefined();
        expect(withDefault.parse(undefined)).toBe(true);
        expect(withDefault.parse("false")).toBe(false);
    });

    test("rejects anything else", () => {
        for (const value of ["yes", "no", "", "TRUE", "2", "null", 1, 0, null]) {
            expect(optional.safeParse(value).success).toBe(false);
        }
    });
});

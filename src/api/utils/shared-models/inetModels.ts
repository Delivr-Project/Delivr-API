import { z } from 'zod';

export namespace InetModels {

    export const IPAddress = z.union([
        z.ipv4("Must be a valid IPv4 address").meta({ title: "IPv4" }),
        z.ipv6("Must be a valid IPv6 address").meta({ title: "IPv6" }),
    ]);
    export type IPAddress = z.infer<typeof IPAddress>;

    export const Host = z.union([
        InetModels.IPAddress,
        z.hostname("Must be a valid hostname").meta({ title: "Hostname" }),
    ]);
    export type Host = z.infer<typeof Host>;

    export const PORT = z.int().min(1, "Port must be at least 1").max(65535, "Port must be at most 65535").meta({ title: "Port" });
    export type PORT = z.infer<typeof PORT>;

}

export namespace InetModels.Mail {

    export const Protocol = z.enum(['IMAP', 'POP3', 'SMTP']);
    export type Protocol = z.infer<typeof Protocol>;

    export const EncryptionTypes = ["SSL", "STARTTLS", "NONE"] as const;
    export const Encryption = z.enum(EncryptionTypes);
    export type Encryption = z.infer<typeof Encryption>;

}


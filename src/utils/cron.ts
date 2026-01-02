import { CronJob } from "cron";
import Mail from "nodemailer/lib/mailer";
import { MailClientsCache } from "./mails/mail-clients-cache";

export class CronJobHandler {

    private static jobs: CronJob[] = [];
    private static initialized: boolean = false;

    static async init() {
        if (this.initialized) return;
        this.initialized = true;
        this.jobs.push(new CronJob('* * * * *', async () => {
            await MailClientsCache.cleanupUnusedClients();
        }));
    }

    static async startAll() {
        if (!this.initialized) {
            await this.init();
        }
        for (const job of this.jobs) {
            job.start();
        }
    }

    static async stopAll() {
        for (const job of this.jobs) {
            await job.stop();
        }
    }

}

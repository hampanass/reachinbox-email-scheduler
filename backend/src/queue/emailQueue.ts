import { Queue } from "bullmq";
import { redisConnection } from "./redis.js";

export interface EmailJobData {
  emailId: string;
}

export const emailQueue = new Queue<EmailJobData>("scheduled-emails", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
});
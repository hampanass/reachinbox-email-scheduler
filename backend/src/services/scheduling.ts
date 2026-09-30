import type { EmailJobData } from "../queue/emailQueue.js";

export interface DelayedJobQueue {
  add(name: string, data: EmailJobData, options: { jobId: string; delay: number }): Promise<unknown>;
}

export function buildSchedule(
  startAt: Date,
  minimumDelayMs: number,
  hourlyLimit: number,
  recipientCount: number,
): Date[] {
  // Respect both the requested floor and a steady per-hour maximum cadence.
  const hourlyCadenceMs = Math.floor(3_600_000 / hourlyLimit) + 1;
  const intervalMs = Math.max(minimumDelayMs, hourlyCadenceMs);

  return Array.from(
    { length: recipientCount },
    (_, index) => new Date(startAt.getTime() + index * intervalMs),
  );
}

export async function enqueueScheduledEmails(
  queue: DelayedJobQueue,
  emails: { id: string; scheduledAt: Date }[],
  now = Date.now(),
): Promise<void> {
  await Promise.all(
    emails.map((email) =>
      queue.add(
        "send-email",
        { emailId: email.id },
        {
          jobId: email.id,
          delay: Math.max(0, email.scheduledAt.getTime() - now),
        },
      ),
    ),
  );
}
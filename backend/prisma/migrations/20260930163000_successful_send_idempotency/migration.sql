-- Prevent duplicate successful delivery records for the same scheduled email.
-- Failed/started attempts remain repeatable for retries.
CREATE UNIQUE INDEX "SendLog_one_success_per_email_key"
ON "SendLog" ("emailId")
WHERE "status" = 'SUCCEEDED';

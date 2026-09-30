-- CreateEnum
CREATE TYPE "SlackRateLimitNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "SlackInstallation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "botUserId" TEXT NOT NULL,
    "botAccessToken" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "installerSlackUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SlackInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlackRateLimitNotification" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nextEligibleAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "SlackRateLimitNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SlackRateLimitNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlackInstallation_userId_idx" ON "SlackInstallation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SlackInstallation_userId_teamId_key" ON "SlackInstallation"("userId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "SlackRateLimitNotification_eventKey_key" ON "SlackRateLimitNotification"("eventKey");

-- CreateIndex
CREATE INDEX "SlackRateLimitNotification_campaignId_createdAt_idx" ON "SlackRateLimitNotification"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "SlackRateLimitNotification_userId_createdAt_idx" ON "SlackRateLimitNotification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "SlackInstallation" ADD CONSTRAINT "SlackInstallation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlackRateLimitNotification" ADD CONSTRAINT "SlackRateLimitNotification_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlackRateLimitNotification" ADD CONSTRAINT "SlackRateLimitNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

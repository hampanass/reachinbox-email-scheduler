import type { Redis } from "ioredis";

const WINDOW_MS = 60 * 60 * 1_000;

const RESERVE_SLOT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local minimumDelay = tonumber(ARGV[2])
local token = ARGV[3]
local window = ${WINDOW_MS}

-- Redis time is authoritative, so worker clock skew cannot alter the shared limit.
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local retention = math.max(window, minimumDelay)

-- Keep enough history for both constraints; prune only records irrelevant to either.
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - retention)

-- Repeating the same reservation after a lost Redis response is idempotent.
if redis.call('ZSCORE', key, token) then
  return {1, 0, 0, now, 0}
end

local last = redis.call('ZREVRANGE', key, 0, 0, 'WITHSCORES')
local minimumDelayWait = 0
if #last > 0 then
  minimumDelayWait = math.max(0, tonumber(last[2]) + minimumDelay - now)
end

local windowStart = now - window
local count = redis.call('ZCOUNT', key, '(' .. windowStart, '+inf')
local hourlyWait = 0
if count >= limit then
  local oldest = redis.call('ZRANGEBYSCORE', key, '(' .. windowStart, '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
  if #oldest > 0 then
    hourlyWait = math.max(0, tonumber(oldest[2]) + window - now + 1)
  end
end

local wait = math.max(minimumDelayWait, hourlyWait)
if wait > 0 or count >= limit then
  local hourlyWindowEndsAt = 0
  if count >= limit then
    local oldest = redis.call('ZRANGEBYSCORE', key, '(' .. windowStart, '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
    if #oldest > 0 then
      hourlyWindowEndsAt = tonumber(oldest[2]) + window + 1
    end
  end
  local actualWait = math.max(1, wait)
  return {0, actualWait, count >= limit and 1 or 0, now + actualWait, hourlyWindowEndsAt}
end

redis.call('ZADD', key, now, token)
redis.call('PEXPIRE', key, retention + 1000)
return {1, 0, 0, now, 0}
`;

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterMs: number;
  hourlyLimitReached: boolean;
  nextEligibleAtMs: number;
  hourlyWindowEndsAtMs: number | null;
};

export function campaignRateLimitKey(campaignId: string): string {
  return `campaign:${campaignId}:send-rate`;
}

export async function reserveCampaignRateSlot(
  redis: Redis,
  campaignId: string,
  hourlyLimit: number,
  minimumDelayMs: number,
  emailId: string,
  attempt: number,
): Promise<RateLimitDecision> {
  if (!Number.isInteger(hourlyLimit) || hourlyLimit < 1) {
    throw new RangeError("hourlyLimit must be a positive integer");
  }
  if (!Number.isInteger(minimumDelayMs) || minimumDelayMs < 0) {
    throw new RangeError("minimumDelayMs must be a non-negative integer");
  }

  const token = `${emailId}:${attempt}`;
  const result = (await redis.eval(
    RESERVE_SLOT_SCRIPT,
    1,
    campaignRateLimitKey(campaignId),
    String(hourlyLimit),
    String(minimumDelayMs),
    token,
  )) as [number | string, number | string, number | string, number | string, number | string];

  return {
    allowed: Number(result[0]) === 1,
    retryAfterMs: Number(result[1]),
    hourlyLimitReached: Number(result[2]) === 1,
    nextEligibleAtMs: Number(result[3]),
    hourlyWindowEndsAtMs: Number(result[4]) || null,
  };
}

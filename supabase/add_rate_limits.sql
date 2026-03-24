-- Run this in the Supabase SQL editor to add rate limiting support.
-- This is additive — safe to run on an existing database.

CREATE TABLE IF NOT EXISTS rate_limits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip         text NOT NULL,
  endpoint   text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Index for fast per-IP lookups within a time window
CREATE INDEX IF NOT EXISTS rate_limits_ip_endpoint_time
  ON rate_limits (ip, endpoint, created_at DESC);

-- Auto-cleanup: delete records older than 24 hours via a scheduled function
-- (optional — the probabilistic cleanup in code handles this too)

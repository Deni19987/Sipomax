-- Two related notification/SMS improvements.
--
-- 1) link_sms_sent_at on jobs: tracks when the introductory "here is your
--    link / how to log in" SMS was sent to the customer. The very first
--    outbound SMS on a job must always be this welcome message, so later
--    status/quote/chat SMS check this column and send the welcome first when
--    it hasn't gone out yet (e.g. the workshop added the phone number only
--    when sending a quote). Existing jobs are backfilled to created_at so
--    customers already mid-flow don't receive a fresh welcome SMS.
--
-- 2) notify_quote_responses on profiles: workshop-level toggle for the push
--    notification sent to every account in the workshop when a customer
--    approves (or rejects) a quote. Defaults on.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS link_sms_sent_at timestamptz;

UPDATE public.jobs
  SET link_sms_sent_at = created_at
  WHERE link_sms_sent_at IS NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_quote_responses boolean NOT NULL DEFAULT true;

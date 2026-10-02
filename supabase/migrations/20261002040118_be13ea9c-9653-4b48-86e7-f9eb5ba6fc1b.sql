CREATE TABLE public.slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  starts_at timestamptz NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.slots TO authenticated;
GRANT ALL ON public.slots TO service_role;
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signed in can view slots" ON public.slots FOR SELECT TO authenticated USING (true);
CREATE POLICY "signed in can create slots" ON public.slots FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES public.slots(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_one_confirmed_per_slot ON public.bookings(slot_id) WHERE status = 'confirmed';
GRANT SELECT ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users view own bookings" ON public.bookings FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.idempotency_keys (
  user_id uuid NOT NULL,
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 255),
  request_hash text NOT NULL,
  status_code int NOT NULL DEFAULT 0,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
GRANT ALL ON public.idempotency_keys TO service_role;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'booking_confirmed',
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','processing','sent','dead')),
  attempts int NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_jobs_due ON public.notification_jobs(status, run_at);
GRANT ALL ON public.notification_jobs TO service_role;
ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rate_buckets (
  key text PRIMARY KEY,
  tokens double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT ALL ON public.rate_buckets TO service_role;
ALTER TABLE public.rate_buckets ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.request_latencies (
  id bigserial PRIMARY KEY,
  op text NOT NULL,
  ms double precision NOT NULL,
  status int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.request_latencies TO service_role;
ALTER TABLE public.request_latencies ENABLE ROW LEVEL SECURITY;

-- Token bucket: capacity 20, refill 5/s per user
CREATE OR REPLACE FUNCTION public.take_token(p_capacity double precision DEFAULT 20, p_refill double precision DEFAULT 5)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text := 'u:' || coalesce(auth.uid()::text, 'anon'); t double precision; ts timestamptz; now_ts timestamptz := clock_timestamp();
BEGIN
  INSERT INTO rate_buckets(key, tokens, updated_at) VALUES (k, p_capacity, now_ts) ON CONFLICT (key) DO NOTHING;
  SELECT tokens, updated_at INTO t, ts FROM rate_buckets WHERE key = k FOR UPDATE;
  t := least(p_capacity, t + extract(epoch FROM now_ts - ts) * p_refill);
  IF t >= 1 THEN
    UPDATE rate_buckets SET tokens = t - 1, updated_at = now_ts WHERE key = k; RETURN true;
  END IF;
  UPDATE rate_buckets SET tokens = t, updated_at = now_ts WHERE key = k; RETURN false;
END $$;

-- Idempotent, double-booking-safe booking
CREATE OR REPLACE FUNCTION public.create_booking(p_slot_id uuid, p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); h text := md5(p_slot_id::text); prev idempotency_keys; s_id uuid; b bookings; code int; body jsonb;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('status',401,'body',jsonb_build_object('detail','Not signed in')); END IF;
  IF p_key IS NULL OR char_length(p_key) NOT BETWEEN 1 AND 255 THEN
    RETURN jsonb_build_object('status',400,'body',jsonb_build_object('detail','Idempotency-Key required'));
  END IF;
  -- Claim key; a concurrent duplicate blocks here until the first commits.
  INSERT INTO idempotency_keys(user_id, key, request_hash) VALUES (uid, p_key, h) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO prev FROM idempotency_keys WHERE user_id = uid AND key = p_key;
    IF prev.request_hash <> h THEN
      RETURN jsonb_build_object('status',422,'body',jsonb_build_object('detail','Idempotency-Key reused with a different request'));
    END IF;
    RETURN jsonb_build_object('status',prev.status_code,'body',prev.response,'replay',true);
  END IF;

  SELECT id INTO s_id FROM slots WHERE id = p_slot_id FOR UPDATE;
  IF s_id IS NULL THEN
    code := 404; body := jsonb_build_object('detail','Slot not found');
  ELSIF EXISTS (SELECT 1 FROM bookings WHERE slot_id = s_id AND status = 'confirmed') THEN
    code := 409; body := jsonb_build_object('detail','Slot already booked');
  ELSE
    BEGIN
      INSERT INTO bookings(slot_id, user_id) VALUES (s_id, uid) RETURNING * INTO b;
      INSERT INTO notification_jobs(booking_id, user_id) VALUES (b.id, uid);
      code := 201; body := jsonb_build_object('id',b.id,'slot_id',b.slot_id,'user_id',b.user_id,'status',b.status);
    EXCEPTION WHEN unique_violation THEN
      code := 409; body := jsonb_build_object('detail','Slot already booked');
    END;
  END IF;
  UPDATE idempotency_keys SET status_code = code, response = body WHERE user_id = uid AND key = p_key;
  RETURN jsonb_build_object('status',code,'body',body,'replay',false);
END $$;

-- Worker: claim due jobs (also reclaims jobs stuck in processing > 2 min)
CREATE OR REPLACE FUNCTION public.claim_jobs(p_limit int DEFAULT 10)
RETURNS SETOF public.notification_jobs LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE notification_jobs j SET status = 'processing', locked_at = now()
  WHERE j.id IN (
    SELECT id FROM notification_jobs
    WHERE (status = 'ready' AND run_at <= now()) OR (status = 'processing' AND locked_at < now() - interval '2 minutes')
    ORDER BY run_at LIMIT least(p_limit, 50) FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
$$;

CREATE OR REPLACE FUNCTION public.complete_job(p_id uuid, p_ok boolean, p_error text DEFAULT NULL, p_max_attempts int DEFAULT 5)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j notification_jobs;
BEGIN
  SELECT * INTO j FROM notification_jobs WHERE id = p_id AND status = 'processing' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF p_ok THEN UPDATE notification_jobs SET status='sent', locked_at=NULL WHERE id=p_id; RETURN 'sent'; END IF;
  IF j.attempts + 1 >= p_max_attempts THEN
    UPDATE notification_jobs SET status='dead', attempts=j.attempts+1, last_error=left(p_error,500), locked_at=NULL WHERE id=p_id; RETURN 'dead';
  END IF;
  UPDATE notification_jobs SET status='ready', attempts=j.attempts+1, last_error=left(p_error,500), locked_at=NULL,
    run_at = now() + make_interval(secs => power(2, j.attempts)) WHERE id=p_id;
  RETURN 'retry';
END $$;

CREATE OR REPLACE FUNCTION public.record_latency(p_op text, p_ms double precision, p_status int)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO request_latencies(op, ms, status) VALUES (left(p_op,60), greatest(p_ms,0), p_status);
$$;

CREATE OR REPLACE FUNCTION public.get_metrics()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'queue_ready', (SELECT count(*) FROM notification_jobs WHERE status='ready' AND run_at <= now()),
    'queue_delayed', (SELECT count(*) FROM notification_jobs WHERE status='ready' AND run_at > now()),
    'queue_processing', (SELECT count(*) FROM notification_jobs WHERE status='processing'),
    'queue_depth', (SELECT count(*) FROM notification_jobs WHERE status IN ('ready','processing')),
    'dlq_depth', (SELECT count(*) FROM notification_jobs WHERE status='dead'),
    'sent_count', (SELECT count(*) FROM notification_jobs WHERE status='sent'),
    'retry_count', (SELECT coalesce(sum(CASE WHEN status='dead' THEN attempts-1 WHEN status='sent' THEN attempts ELSE attempts END),0) FROM notification_jobs),
    'bookings_total', (SELECT count(*) FROM bookings),
    'p95_latency_ms', (SELECT coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms),0) FROM (SELECT ms FROM request_latencies ORDER BY id DESC LIMIT 1000) x),
    'p50_latency_ms', (SELECT coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms),0) FROM (SELECT ms FROM request_latencies ORDER BY id DESC LIMIT 1000) x),
    'samples', (SELECT count(*) FROM (SELECT 1 FROM request_latencies ORDER BY id DESC LIMIT 1000) x)
  );
$$;

REVOKE ALL ON FUNCTION public.take_token(double precision,double precision), public.create_booking(uuid,text), public.claim_jobs(int), public.complete_job(uuid,boolean,text,int), public.record_latency(text,double precision,int), public.get_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.take_token(double precision,double precision), public.create_booking(uuid,text), public.claim_jobs(int), public.complete_job(uuid,boolean,text,int), public.record_latency(text,double precision,int), public.get_metrics() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_metrics() TO anon;
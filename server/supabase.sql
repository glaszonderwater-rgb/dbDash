-- IDA meldingenserver: tabellen in Supabase (SQL Editor › New query › Run).
-- Alleen de server (service-role-sleutel) leest en schrijft; RLS staat aan zonder regels, dus de publieke sleutel kan niets.
create table if not exists public.ida_push_subscriptions (
  endpoint   text primary key,
  sub        jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.ida_push_sent (
  key        text primary key,
  at         timestamptz not null default now()
);
alter table public.ida_push_subscriptions enable row level security;
alter table public.ida_push_sent enable row level security;
-- Opruimen van oude verzonden-sleutels (optioneel, bv. wekelijks):
-- delete from public.ida_push_sent where at < now() - interval '7 days';

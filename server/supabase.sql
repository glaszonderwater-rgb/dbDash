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
create table if not exists public.ida_state (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.ida_state enable row level security;
alter table public.ida_push_subscriptions enable row level security;
alter table public.ida_push_sent enable row level security;
-- Nieuwe projecten geven tabellen niet meer automatisch API-toegang: alleen de server-rol krijgt rechten.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.ida_push_subscriptions, public.ida_push_sent, public.ida_state to service_role;
-- Opruimen van oude verzonden-sleutels (optioneel, bv. wekelijks):
-- delete from public.ida_push_sent where at < now() - interval '7 days';

-- =========================================================
-- New Idol Project
-- Supabase database schema
-- =========================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create schema if not exists private;

-- =========================================================
-- TABLES
-- =========================================================

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  username text not null,
  role text not null check (role in ('staff', 'idol')),
  display_name text not null,
  created_at timestamptz not null default now(),
  unique (group_id, username, role)
);

create table if not exists private.login_map (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  login_email text not null unique
);

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null unique references public.groups(id) on delete cascade,
  event_name text not null default 'New Idol Project',
  timer_seconds integer not null default 60 check (timer_seconds > 0),
  timetree_url text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  price integer not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  unit_price integer not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  total_amount integer not null check (total_amount >= 0),
  payment_method text not null
    check (payment_method in ('cash', 'card', 'paypay')),
  sold_at timestamptz not null default now()
);

create table if not exists public.sales_archive (
  id uuid primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  product_id uuid not null,
  product_name text not null,
  unit_price integer not null,
  quantity integer not null,
  total_amount integer not null,
  payment_method text not null,
  sold_at timestamptz not null,
  archived_at timestamptz not null default now()
);

create table if not exists public.health_records (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  idol_id uuid not null references public.profiles(id) on delete cascade,
  record_date date not null,
  wake_time timestamptz,
  health text check (health in ('bad', 'okay', 'good')),
  memo text,
  updated_at timestamptz not null default now(),
  unique (idol_id, record_date)
);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  type text not null check (type in ('event', 'unavailable')),
  title text not null,
  event_date date not null,
  start_time time,
  end_time time,
  location text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- INDEXES
-- =========================================================

create index if not exists idx_profiles_group_id
  on public.profiles(group_id);

create index if not exists idx_members_group_id
  on public.members(group_id);

create index if not exists idx_products_group_id
  on public.products(group_id);

create index if not exists idx_sales_group_id_sold_at
  on public.sales(group_id, sold_at);

create index if not exists idx_sales_archive_group_id_sold_at
  on public.sales_archive(group_id, sold_at);

create index if not exists idx_health_group_date
  on public.health_records(group_id, record_date);

create index if not exists idx_schedules_group_date
  on public.schedules(group_id, event_date);

-- =========================================================
-- UPDATED_AT TRIGGER
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_settings_updated_at on public.settings;
create trigger trg_settings_updated_at
before update on public.settings
for each row
execute function public.set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row
execute function public.set_updated_at();

drop trigger if exists trg_health_updated_at on public.health_records;
create trigger trg_health_updated_at
before update on public.health_records
for each row
execute function public.set_updated_at();

drop trigger if exists trg_schedules_updated_at on public.schedules;
create trigger trg_schedules_updated_at
before update on public.schedules
for each row
execute function public.set_updated_at();

-- =========================================================
-- HELPER FUNCTIONS
-- =========================================================

create or replace function public.my_group_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select group_id
  from public.profiles
  where id = auth.uid()
  limit 1;
$$;

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
  limit 1;
$$;

-- =========================================================
-- GROUP AUTHENTICATION
-- Called before Supabase Auth login.
-- =========================================================

create or replace function public.verify_group(
  p_group_code text,
  p_password text
)
returns table (
  id uuid,
  group_code text,
  group_name text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select
    g.id,
    g.code,
    g.name
  from public.groups g
  where g.code = p_group_code
    and g.password_hash = extensions.crypt(
      p_password,
      g.password_hash
    );
end;
$$;

-- =========================================================
-- LOGIN EMAIL LOOKUP
-- The browser uses a username, while Supabase Auth uses email.
-- =========================================================

create or replace function public.get_login_email(
  p_group_code text,
  p_username text,
  p_role text
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  result_email text;
begin
  if p_role not in ('staff', 'idol') then
    return null;
  end if;

  select lm.login_email
  into result_email
  from public.groups g
  join public.profiles p
    on p.group_id = g.id
  join private.login_map lm
    on lm.auth_user_id = p.id
  where g.code = p_group_code
    and p.username = p_username
    and p.role = p_role
  limit 1;

  return result_email;
end;
$$;

-- =========================================================
-- REGISTER SALE
-- Atomic sale registration + stock reduction.
-- =========================================================

create or replace function public.register_sale(
  p_product_id uuid,
  p_quantity integer,
  p_payment_method text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_product_name text;
  v_unit_price integer;
  v_stock integer;
  v_sale_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  if public.my_role() <> 'staff' then
    raise exception 'スタッフのみ売上を登録できます';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception '数量が正しくありません';
  end if;

  if p_payment_method not in ('cash', 'card', 'paypay') then
    raise exception '支払い方法が正しくありません';
  end if;

  v_group_id := public.my_group_id();

  select
    name,
    price,
    stock
  into
    v_product_name,
    v_unit_price,
    v_stock
  from public.products
  where id = p_product_id
    and group_id = v_group_id
  for update;

  if not found then
    raise exception '商品が見つかりません';
  end if;

  if v_stock < p_quantity then
    raise exception '在庫が不足しています';
  end if;

  insert into public.sales (
    group_id,
    product_id,
    product_name,
    unit_price,
    quantity,
    total_amount,
    payment_method,
    sold_at
  )
  values (
    v_group_id,
    p_product_id,
    v_product_name,
    v_unit_price,
    p_quantity,
    v_unit_price * p_quantity,
    p_payment_method,
    now()
  )
  returning id into v_sale_id;

  update public.products
  set stock = stock - p_quantity,
      updated_at = now()
  where id = p_product_id
    and group_id = v_group_id;

  return v_sale_id;
end;
$$;

-- =========================================================
-- ARCHIVE SALES OLDER THAN ONE YEAR
-- =========================================================

create or replace function public.archive_old_sales()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  moved_count integer;
begin
  with moved as (
    insert into public.sales_archive (
      id,
      group_id,
      product_id,
      product_name,
      unit_price,
      quantity,
      total_amount,
      payment_method,
      sold_at,
      archived_at
    )
    select
      id,
      group_id,
      product_id,
      product_name,
      unit_price,
      quantity,
      total_amount,
      payment_method,
      sold_at,
      now()
    from public.sales
    where sold_at < now() - interval '1 year'
    returning id
  )
  select count(*) into moved_count
  from moved;

  delete from public.sales
  where sold_at < now() - interval '1 year';

  return moved_count;
end;
$$;

-- =========================================================
-- SEED GROUP
-- Initial group:
-- code     = test
-- password = test1234
-- =========================================================

insert into public.groups (
  code,
  name,
  password_hash
)
values (
  'test',
  'New Idol Project',
  extensions.crypt(
    'test1234',
    extensions.gen_salt('bf')
  )
)
on conflict (code) do nothing;

-- =========================================================
-- DEFAULT SETTINGS
-- =========================================================

insert into public.settings (
  group_id,
  event_name,
  timer_seconds,
  timetree_url
)
select
  id,
  'New Idol Project',
  60,
  ''
from public.groups
where code = 'test'
on conflict (group_id) do nothing;

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================

alter table public.groups enable row level security;
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.members enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sales_archive enable row level security;
alter table public.health_records enable row level security;
alter table public.schedules enable row level security;

-- =========================================================
-- PROFILES
-- Users in the same group can see basic profile information.
-- Health data is protected separately.
-- =========================================================

drop policy if exists profiles_select_same_group
on public.profiles;

create policy profiles_select_same_group
on public.profiles
for select
to authenticated
using (
  group_id = public.my_group_id()
);

-- =========================================================
-- SETTINGS
-- =========================================================

drop policy if exists settings_select_same_group
on public.settings;

create policy settings_select_same_group
on public.settings
for select
to authenticated
using (
  group_id = public.my_group_id()
);

drop policy if exists settings_staff_insert
on public.settings;

create policy settings_staff_insert
on public.settings
for insert
to authenticated
with check (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

drop policy if exists settings_staff_update
on public.settings;

create policy settings_staff_update
on public.settings
for update
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
)
with check (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

-- =========================================================
-- MEMBERS
-- =========================================================

drop policy if exists members_staff_select
on public.members;

create policy members_staff_select
on public.members
for select
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

drop policy if exists members_staff_insert
on public.members;

create policy members_staff_insert
on public.members
for insert
to authenticated
with check (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

drop policy if exists members_staff_update
on public.members;

create policy members_staff_update
on public.members
for update
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
)
with check (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

drop policy if exists members_staff_delete
on public.members;

create policy members_staff_delete
on public.members
for delete
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

-- =========================================================
-- PRODUCTS
-- =========================================================

drop policy if exists products_staff_select
on public.products;

create policy products_staff_select
on public.products
for select
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

drop policy if exists products_staff_insert
on public.products;

create policy products_staff_insert
on public.products
for insert
to authenticated
with check (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

drop policy if exists products_staff_update
on public.products;

create policy products_staff_update
on public.products
for update
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
)
with check (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

drop policy if exists products_staff_delete
on public.products;

create policy products_staff_delete
on public.products
for delete
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

-- =========================================================
-- SALES
-- Client can only READ.
-- INSERT is done by register_sale().
-- =========================================================

drop policy if exists sales_staff_select
on public.sales;

create policy sales_staff_select
on public.sales
for select
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

-- =========================================================
-- SALES ARCHIVE
-- Client can only READ.
-- =========================================================

drop policy if exists sales_archive_staff_select
on public.sales_archive;

create policy sales_archive_staff_select
on public.sales_archive
for select
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

-- =========================================================
-- HEALTH RECORDS
-- =========================================================

drop policy if exists health_staff_select
on public.health_records;

create policy health_staff_select
on public.health_records
for select
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

drop policy if exists health_idol_select_own
on public.health_records;

create policy health_idol_select_own
on public.health_records
for select
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'idol'
  and idol_id = auth.uid()
);

drop policy if exists health_idol_insert_own
on public.health_records;

create policy health_idol_insert_own
on public.health_records
for insert
to authenticated
with check (
  group_id = public.my_group_id()
  and public.my_role() = 'idol'
  and idol_id = auth.uid()
);

drop policy if exists health_idol_update_own
on public.health_records;

create policy health_idol_update_own
on public.health_records
for update
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'idol'
  and idol_id = auth.uid()
)
with check (
  group_id = public.my_group_id()
  and public.my_role() = 'idol'
  and idol_id = auth.uid()
);

-- =========================================================
-- SCHEDULES
-- =========================================================

drop policy if exists schedules_select_same_group
on public.schedules;

create policy schedules_select_same_group
on public.schedules
for select
to authenticated
using (
  group_id = public.my_group_id()
);

drop policy if exists schedules_staff_insert
on public.schedules;

create policy schedules_staff_insert
on public.schedules
for insert
to authenticated
with check (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
  and created_by = auth.uid()
);

drop policy if exists schedules_staff_update
on public.schedules;

create policy schedules_staff_update
on public.schedules
for update
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
)
with check (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

drop policy if exists schedules_staff_delete
on public.schedules;

create policy schedules_staff_delete
on public.schedules
for delete
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'staff'
);

drop policy if exists schedules_idol_insert_unavailable
on public.schedules;

create policy schedules_idol_insert_unavailable
on public.schedules
for insert
to authenticated
with check (
  group_id = public.my_group_id()
  and public.my_role() = 'idol'
  and type = 'unavailable'
  and created_by = auth.uid()
);

drop policy if exists schedules_idol_update_own
on public.schedules;

create policy schedules_idol_update_own
on public.schedules
for update
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'idol'
  and type = 'unavailable'
  and created_by = auth.uid()
)
with check (
  group_id = public.my_group_id()
  and public.my_role() = 'idol'
  and type = 'unavailable'
  and created_by = auth.uid()
);

drop policy if exists schedules_idol_delete_own
on public.schedules;

create policy schedules_idol_delete_own
on public.schedules
for delete
to authenticated
using (
  group_id = public.my_group_id()
  and public.my_role() = 'idol'
  and type = 'unavailable'
  and created_by = auth.uid()
);

-- =========================================================
-- FUNCTION PERMISSIONS
-- =========================================================

grant execute on function public.verify_group(text, text)
to anon, authenticated;

grant execute on function public.get_login_email(text, text, text)
to anon, authenticated;

grant execute on function public.register_sale(uuid, integer, text)
to authenticated;

grant execute on function public.archive_old_sales()
to postgres;

-- =========================================================
-- PRIVATE LOGIN MAP SECURITY
-- =========================================================

revoke all on schema private from anon, authenticated;

revoke all on private.login_map from anon, authenticated;

-- =========================================================
-- DAILY ARCHIVE
-- 00:10 JST = 15:10 UTC
-- =========================================================

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'archive-old-sales-daily'
  ) then
    perform cron.unschedule('archive-old-sales-daily');
  end if;
exception
  when undefined_table then
    null;
end;
$$;

select cron.schedule(
  'archive-old-sales-daily',
  '10 15 * * *',
  $$select public.archive_old_sales();$$
);

-- =========================================================
-- DONE
-- =========================================================
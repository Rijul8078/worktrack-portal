create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'client' check (role in ('admin','staff','client')),
  created_at timestamptz default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text unique not null,
  title text not null,
  description text,
  business_type text check (business_type in ('it_services','academic','other')),
  status text default 'not_started' check (status in ('not_started','in_progress','on_hold','completed','cancelled')),
  priority text default 'normal' check (priority in ('low','normal','high','urgent')),
  estimated_budget numeric(12,2),
  actual_budget numeric(12,2),
  currency_code text default 'USD' check (currency_code in ('USD','INR','EUR','GBP')),
  sla_target_hours integer default 72 check (sla_target_hours > 0),
  escalation_level text default 'none' check (escalation_level in ('none','warning','critical')),
  escalation_reason text,
  escalated_at timestamptz,
  due_date date,
  client_id uuid references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  author_id uuid references public.profiles(id),
  content text not null,
  is_internal boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.order_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  uploaded_by uuid references public.profiles(id),
  file_name text not null,
  file_size bigint,
  mime_type text,
  file_category text default 'other' check (file_category in ('assignment_brief','code_solution','archive_zip','document','other')),
  storage_path text not null,
  created_at timestamptz default now()
);

alter table public.orders
  add column if not exists currency_code text default 'USD' check (currency_code in ('USD','INR','EUR','GBP'));
alter table public.orders
  add column if not exists sla_target_hours integer default 72 check (sla_target_hours > 0);
alter table public.orders
  add column if not exists escalation_level text default 'none' check (escalation_level in ('none','warning','critical'));
alter table public.orders
  add column if not exists escalation_reason text;
alter table public.orders
  add column if not exists escalated_at timestamptz;

alter table public.order_files
  add column if not exists file_category text default 'other' check (file_category in ('assignment_brief','code_solution','archive_zip','document','other'));

create index if not exists idx_orders_client_id on public.orders(client_id);
create index if not exists idx_orders_assigned_to on public.orders(assigned_to);
create index if not exists idx_orders_updated_at on public.orders(updated_at desc);
create index if not exists idx_comments_order_id on public.comments(order_id);
create index if not exists idx_order_files_order_id on public.order_files(order_id);
create index if not exists idx_order_files_storage_path on public.order_files(storage_path);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_orders_set_updated_at on public.orders;
create trigger trg_orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'client'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.comments enable row level security;
alter table public.order_files enable row level security;

-- profiles policies
create policy "profiles_select_authenticated"
on public.profiles
for select
to authenticated
using (true);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "profiles_update_admin"
on public.profiles
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (true);

-- orders policies
create policy "orders_select_by_role"
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin','staff')
  )
  or client_id = auth.uid()
);

create policy "orders_insert_admin_staff"
on public.orders
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin','staff')
  )
);

create policy "orders_update_admin_staff"
on public.orders
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin','staff')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin','staff')
  )
);

create policy "orders_delete_admin_only"
on public.orders
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

-- comments policies
create policy "comments_select_by_role"
on public.comments
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin','staff')
  )
  or (
    is_internal = false
    and exists (
      select 1
      from public.orders o
      where o.id = comments.order_id
        and o.client_id = auth.uid()
    )
  )
);

create policy "comments_insert_by_role"
on public.comments
for insert
to authenticated
with check (
  (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin','staff')
    )
  )
  or (
    author_id = auth.uid()
    and is_internal = false
    and exists (
      select 1
      from public.orders o
      where o.id = comments.order_id
        and o.client_id = auth.uid()
    )
  )
);

create policy "comments_update_author_or_admin"
on public.comments
for update
to authenticated
using (
  author_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  author_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy "comments_delete_author_or_admin"
on public.comments
for delete
to authenticated
using (
  author_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

-- order_files policies
create policy "order_files_select_by_role"
on public.order_files
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin','staff')
  )
  or exists (
    select 1
    from public.orders o
    where o.id = order_files.order_id
      and o.client_id = auth.uid()
  )
);

create policy "order_files_insert_admin_staff"
on public.order_files
for insert
to authenticated
with check (
  (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin','staff')
    )
  )
  or (
    uploaded_by = auth.uid()
    and exists (
      select 1
      from public.orders o
      where o.id = order_files.order_id
        and o.client_id = auth.uid()
    )
  )
);

create policy "order_files_delete_admin_only"
on public.order_files
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

insert into storage.buckets (id, name, public)
values ('order-files', 'order-files', false)
on conflict (id) do nothing;

-- storage.objects policies for order-files bucket
create policy "storage_order_files_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'order-files'
  and (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin','staff')
    )
    or exists (
      select 1
      from public.order_files ofi
      join public.orders o on o.id = ofi.order_id
      where ofi.storage_path = storage.objects.name
        and o.client_id = auth.uid()
    )
  )
);

create policy "storage_order_files_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'order-files'
  and (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin','staff')
    )
    or exists (
      select 1
      from public.orders o
      where o.client_id = auth.uid()
        and split_part(storage.objects.name, '/', 1) ~* '^[0-9a-f-]{36}$'
        and o.id = split_part(storage.objects.name, '/', 1)::uuid
    )
  )
);

create policy "storage_order_files_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'order-files'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

-- ============================================================
-- Sharabaty – Supabase setup
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- BEFORE running: change YOUR_EMAIL@example.com (line marked "EDIT ME")
-- to the email you will use to sign in to the admin page.
-- It is safe to run more than once.
-- ============================================================

-- ---------- Tables ----------
create table if not exists public.products (
  id          text primary key,
  sort_order  bigint generated always as identity,
  name        text    not null,
  category    text    not null,
  price       numeric not null check (price >= 0),
  stock       integer not null default 0 check (stock >= 0),
  badge       text    not null default '',
  description text    not null default '',
  pattern     text    not null default 'plain',
  accent      text    not null default '#ffc93c',
  colors      jsonb   not null default '[]'::jsonb,
  sizes       jsonb   not null default '[]'::jsonb,
  images      jsonb   not null default '[]'::jsonb
);

create table if not exists public.orders (
  id         text primary key,
  created_at timestamptz not null default now(),
  customer   jsonb   not null,
  items      jsonb   not null,
  subtotal   numeric not null,
  shipping   numeric not null,
  total      numeric not null,
  payment    jsonb   not null,
  status     text    not null default 'pending'
    check (status in ('pending','confirmed','shipped','delivered','cancelled'))
);

-- Who is allowed to use the admin page
create table if not exists public.admins (
  email text primary key
);
insert into public.admins (email) values ('YOUR_EMAIL@example.com')   -- <== EDIT ME
on conflict do nothing;

-- ---------- Helper: is the signed-in user an admin? ----------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- Row Level Security ----------
alter table public.products enable row level security;
alter table public.orders   enable row level security;
alter table public.admins   enable row level security;   -- no policies = nobody can read it directly

drop policy if exists "Anyone can read products" on public.products;
create policy "Anyone can read products" on public.products
  for select using (true);

drop policy if exists "Admins manage products" on public.products;
create policy "Admins manage products" on public.products
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins read orders" on public.orders;
create policy "Admins read orders" on public.orders
  for select to authenticated
  using (public.is_admin());
-- Orders have NO insert/update policy on purpose: customers create them only
-- through place_order() below, and the admin changes status through
-- admin_set_order_status().

-- ---------- Customers place orders here ----------
-- Prices, delivery fee and stock are checked on the SERVER, so nobody can
-- change a price from the browser.
create or replace function public.place_order(p_customer jsonb, p_items jsonb, p_payment jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  -- Keep these in sync with CONFIG in app.js
  c_flat_shipping   constant numeric := 50;
  c_free_threshold  constant numeric := 600;
  -- Card payments are only SIMULATED in this project. Leave this false until
  -- you have connected a real payment gateway (see SETUP-SUPABASE.md).
  c_cards_enabled   constant boolean := false;

  v_item     jsonb;
  v_prod     public.products%rowtype;
  v_qty      integer;
  v_subtotal numeric := 0;
  v_shipping numeric;
  v_lines    jsonb := '[]'::jsonb;
  v_id       text;
  v_method   text := coalesce(p_payment ->> 'method', 'cod');
  v_pay      jsonb;
  v_cust     jsonb;
  v_row      public.orders%rowtype;
begin
  if length(trim(coalesce(p_customer ->> 'name',    ''))) < 2
  or length(trim(coalesce(p_customer ->> 'phone',   ''))) < 8
  or length(trim(coalesce(p_customer ->> 'address', ''))) < 6
  or length(trim(coalesce(p_customer ->> 'city',    ''))) < 2 then
    raise exception 'Please fill in your name, phone, address and city.';
  end if;

  v_cust := jsonb_build_object(
    'name',    left(trim(p_customer ->> 'name'),    80),
    'phone',   left(trim(p_customer ->> 'phone'),   30),
    'address', left(trim(p_customer ->> 'address'), 200),
    'city',    left(trim(p_customer ->> 'city'),    60),
    'notes',   left(trim(coalesce(p_customer ->> 'notes', '')), 300)
  );

  if v_method not in ('cod', 'card') then
    raise exception 'Unknown payment method.';
  end if;
  if v_method = 'card' and not c_cards_enabled then
    raise exception 'Card payments are not available yet. Please choose cash on delivery.';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many items in one order.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_qty := (v_item ->> 'qty')::integer;
    exception when others then
      v_qty := null;
    end;
    if v_qty is null or v_qty < 1 or v_qty > 50 then
      raise exception 'Invalid quantity.';
    end if;

    select * into v_prod from public.products where id = v_item ->> 'productId' for update;
    if not found then
      raise exception 'A product in your cart is no longer available.';
    end if;
    if v_prod.stock < v_qty then
      raise exception 'Sorry, only % of "%" left in stock.', v_prod.stock, v_prod.name;
    end if;
    if not exists (select 1 from jsonb_array_elements(v_prod.colors) c where c ->> 'name' = v_item ->> 'color') then
      raise exception 'Invalid colour for "%".', v_prod.name;
    end if;
    if not (v_prod.sizes ? (v_item ->> 'size')) then
      raise exception 'Invalid size for "%".', v_prod.name;
    end if;

    update public.products set stock = stock - v_qty where id = v_prod.id;
    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'productId', v_prod.id, 'name', v_prod.name,
      'color', v_item ->> 'color', 'size', v_item ->> 'size',
      'qty', v_qty, 'price', v_prod.price
    ));
  end loop;

  v_shipping := case when v_subtotal >= c_free_threshold then 0 else c_flat_shipping end;

  if v_method = 'card' then
    v_pay := jsonb_build_object(
      'method', 'card', 'status', 'paid',
      'last4', left(coalesce(p_payment ->> 'last4', ''), 4),
      'transactionId', left(coalesce(p_payment ->> 'transactionId', ''), 80)
    );
  else
    v_pay := jsonb_build_object('method', 'cod', 'status', 'pending');
  end if;

  v_id := 'SH-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.orders (id, customer, items, subtotal, shipping, total, payment, status)
  values (v_id, v_cust, v_lines, v_subtotal, v_shipping, v_subtotal + v_shipping, v_pay, 'pending')
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'createdAt', v_row.created_at, 'customer', v_row.customer,
    'items', v_row.items, 'subtotal', v_row.subtotal, 'shipping', v_row.shipping,
    'total', v_row.total, 'payment', v_row.payment, 'status', v_row.status
  );
end;
$$;

-- ---------- Admin changes an order's status ----------
-- Cancelling puts the socks back in stock; un-cancelling takes them out again.
create or replace function public.admin_set_order_status(p_id text, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  o  public.orders%rowtype;
  it jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  if p_status not in ('pending','confirmed','shipped','delivered','cancelled') then
    raise exception 'Invalid status';
  end if;

  select * into o from public.orders where id = p_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if o.status = p_status then
    return;
  end if;

  if p_status = 'cancelled' then
    for it in select * from jsonb_array_elements(o.items) loop
      update public.products set stock = stock + (it ->> 'qty')::integer where id = it ->> 'productId';
    end loop;
  elsif o.status = 'cancelled' then
    for it in select * from jsonb_array_elements(o.items) loop
      update public.products set stock = greatest(0, stock - (it ->> 'qty')::integer) where id = it ->> 'productId';
    end loop;
  end if;

  update public.orders
     set status  = p_status,
         payment = case when p_status = 'delivered' and payment ->> 'method' = 'cod'
                        then jsonb_set(payment, '{status}', '"paid"') else payment end
   where id = p_id;
end;
$$;

-- ---------- Admin +/- stock buttons ----------
-- Adds or subtracts on the server, so a sale that happens while you have the
-- admin page open is never overwritten by an old number.
create or replace function public.admin_adjust_stock(p_id text, p_delta integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_stock integer;
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  update public.products
     set stock = greatest(0, stock + p_delta)
   where id = p_id
   returning stock into v_stock;
  if not found then
    raise exception 'Product not found';
  end if;
  return v_stock;
end;
$$;

revoke all on function public.place_order(jsonb, jsonb, jsonb)       from public;
revoke all on function public.admin_set_order_status(text, text)     from public;
revoke all on function public.admin_adjust_stock(text, integer)      from public;
revoke all on function public.is_admin()                             from public;
grant execute on function public.place_order(jsonb, jsonb, jsonb)    to anon, authenticated;
grant execute on function public.admin_set_order_status(text, text) to authenticated;
grant execute on function public.admin_adjust_stock(text, integer)   to authenticated;
grant execute on function public.is_admin()                          to authenticated;

-- ---------- Product photo storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "Admins upload product images" on storage.objects;
create policy "Admins upload product images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Admins delete product images" on storage.objects;
create policy "Admins delete product images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

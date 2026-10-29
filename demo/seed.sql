-- Demo database "orders": what the fixture services (test/fixtures, demo/mock.js) talk to.
drop schema if exists sales cascade;
create schema sales;
comment on schema sales is 'Orders, items and payments';

create table sales.customers (id bigserial primary key, email text not null unique, name text, segment text default 'retail');
create table sales.orders (id bigserial primary key, customer_id bigint references sales.customers(id), status text not null default 'new', total numeric(12,2) not null default 0, created_at timestamptz not null default now());
comment on table sales.orders is 'One row per checkout';
comment on column sales.orders.status is 'new | paid | shipped | closed | payment_failed';
create index orders_customer_idx on sales.orders (customer_id, created_at desc);
create table sales.order_items (id bigserial primary key, order_id bigint not null references sales.orders(id), sku text not null, qty int not null default 1, price numeric(12,2));
create table sales.order_audit (id bigserial primary key, order_id bigint, old_status text, new_status text, ts timestamptz default now());
create table sales.payments (order_id bigint primary key references sales.orders(id), amount numeric(12,2), status text, updated_at timestamptz default now());

create view sales.open_orders as
  select o.id, c.email, o.total, o.created_at from sales.orders o join sales.customers c on c.id = o.customer_id where o.status in ('new', 'paid');
create materialized view sales.daily_revenue as
  select date_trunc('day', created_at) as day, sum(total) as revenue, count(*) as orders from sales.orders group by 1;

create function sales.fn_order_total(p_id bigint) returns numeric language sql stable as $$
  select coalesce(sum(qty * price), 0) from sales.order_items where order_id = p_id
$$;
create function sales.order_total(p_order_id bigint, p_with_tax boolean default false) returns numeric language plpgsql stable as $$
begin
  return sales.fn_order_total(p_order_id) * case when p_with_tax then 1.2 else 1 end;
end $$;
comment on function sales.order_total(bigint, boolean) is 'Total of an order, optionally with 20% tax';
create function sales.calc_tax(p_id bigint) returns numeric language plpgsql as $$
begin return sales.order_total(p_id, true) - sales.order_total(p_id, false); end $$;
create function sales.audit_status() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    insert into sales.order_audit (order_id, old_status, new_status) values (new.id, old.status, new.status);
  end if;
  return new;
end $$;
create trigger orders_status_audit after update on sales.orders for each row execute function sales.audit_status();
create procedure sales.close_order(in p_id bigint) language plpgsql as $$
begin
  update sales.orders set status = 'closed' where id = p_id;
  perform sales.order_total(p_id, false);
end $$;

-- A wide read function the UI services grew around, and the specialised sources replacing parts of it
-- (the "order card" migration in the demo: trace the deprecated fields, then read them at their source).
create table sales.customer_contacts (customer_id bigint primary key references sales.customers(id), email text not null, phone text, verified boolean not null default false);
comment on table sales.customer_contacts is 'Verified contact data; replaces sales.customers.email for messaging';
create function sales.customer_contact(p_customer_id bigint) returns table(email text, phone text, verified boolean) language sql stable as $$
  select coalesce(cc.email, c.email), cc.phone, coalesce(cc.verified, false)
  from sales.customers c left join sales.customer_contacts cc on cc.customer_id = c.id where c.id = p_customer_id
$$;
create function sales.order_payment_status(p_order_id bigint) returns text language sql stable as $$
  select status from sales.payments where order_id = p_order_id
$$;
create function sales.order_card(p_id bigint) returns table(order_id bigint, status text, created_at timestamptz, customer_id bigint, customer_name text, customer_email text,
    segment text, item_count int, total numeric, total_with_tax numeric, legacy_discount numeric, last_payment_status text) language sql stable as $$
  select o.id, o.status, o.created_at, c.id, c.name, c.email, c.segment,
         (select count(*)::int from sales.order_items i where i.order_id = o.id),
         o.total, round(o.total * 1.2, 2), case when c.segment = 'vip' then 5 else 0 end,
         (select p.status from sales.payments p where p.order_id = o.id)
  from sales.orders o join sales.customers c on c.id = o.customer_id where o.id = p_id
$$;
comment on function sales.order_card(bigint) is 'Order card for UIs. DEPRECATED fields, removed in 2027.1: customer_email -> sales.customer_contact(customer_id).email; total -> sales.order_total(order_id); total_with_tax -> sales.order_total(order_id, true); last_payment_status -> sales.order_payment_status(order_id); legacy_discount -> no replacement (0 since pricing v2). Read the other fields from sales.orders and sales.customers directly.';

insert into sales.customers (email, name) select 'customer' || g || '@example.com', 'Customer ' || g from generate_series(1, 40) g;
insert into sales.orders (customer_id, status, total, created_at)
  select 1 + g % 40, (array['new','paid','shipped','closed','payment_failed'])[1 + g % 5], 20 + (g * 7) % 300, now() - (g || ' hours')::interval from generate_series(1, 400) g;
insert into sales.order_items (order_id, sku, qty, price) select 1 + g % 400, 'SKU-' || (100 + g % 9), 1 + g % 3, 9.9 + g % 50 from generate_series(1, 900) g;
insert into sales.customer_contacts (customer_id, email, phone, verified) select g, 'c' || g || '@mail.example.com', '+1555' || lpad(g::text, 4, '0'), g % 3 = 0 from generate_series(1, 40, 2) g;
update sales.customers set segment = 'vip' where id % 7 = 0;
insert into sales.payments (order_id, amount, status) select id, total, (array['captured','refunded','pending'])[1 + id % 3] from sales.orders where id % 4 = 0;
analyze;

drop schema if exists shop cascade;
drop table if exists public.settings;
create schema shop;
create table shop.customers (id bigserial primary key, email text not null unique, name text);
comment on table shop.customers is 'People who buy';
create table shop.orders (id bigserial primary key, customer_id bigint references shop.customers(id), total numeric(12,2) not null default 0, status text);
create table shop.order_items (id bigserial primary key, order_id bigint not null references shop.orders(id), sku text, qty int);
create table shop.audit_log (id bigserial primary key, entity text, entity_id bigint, at timestamptz default now());
create table public.settings (k text primary key, v text);
create view shop.order_totals as select o.id, c.email, sum(i.qty) as items from shop.orders o join shop.customers c on c.id = o.customer_id left join shop.order_items i on i.order_id = o.id group by 1,2;
create function shop.order_total(p_order_id bigint, p_with_tax boolean default false) returns numeric language plpgsql stable as $$
declare t numeric;
begin
  select total into t from shop.orders where id = p_order_id;
  return case when p_with_tax then t * 1.2 else t end;
end $$;
create function shop.audit() returns trigger language plpgsql as $$
begin
  insert into shop.audit_log(entity, entity_id) values (TG_TABLE_NAME, NEW.id);
  return NEW;
end $$;
create trigger orders_audit after insert or update on shop.orders for each row execute function shop.audit();
create procedure shop.close_order(in p_id bigint, inout p_status text) language plpgsql as $$
begin
  update shop.orders set status = 'closed' where id = p_id;
  perform shop.order_total(p_id);
  p_status := 'closed';
end $$;
create function shop.customer_orders(p_customer bigint) returns table(order_id bigint, total numeric) language sql as $$ select id, total from shop.orders where customer_id = p_customer $$;
create view shop.big_orders as select * from shop.customer_orders(1) where total > shop.order_total(1);

-- DDL snapshot of fixture/orders (dt_test_098578d208c80cff2f0173bff688), synced 2026-10-28T21:53:04.687Z by dt.
-- 3 tables, 0 views, 4 functions.
-- Regenerate with the ddl_snapshot tool; data: only the rows of dictionary tables (0).
-- dt: tables=sales.accounts,sales.orders,sales.order_audit views= functions=sales.order_projection,sales.account_label,sales.release_label,sales.audit_amount

set check_function_bodies = false;

create schema if not exists sales;

create table sales.accounts (
  tenant_id bigint not null,
  id bigint not null,
  enabled boolean not null,
  constraint accounts_pkey PRIMARY KEY (tenant_id, id)
);

create table sales.order_audit (
  tenant_id bigint,
  order_id bigint,
  old_amount numeric(20,6),
  new_amount numeric(20,6)
);

create table sales.orders (
  tenant_id bigint not null,
  id bigint not null,
  account_id bigint,
  status text,
  amount numeric(20,6),
  constraint orders_pkey PRIMARY KEY (tenant_id, id)
);

alter table sales.orders add constraint orders_tenant_id_account_id_fkey FOREIGN KEY (tenant_id, account_id) REFERENCES sales.accounts(tenant_id, id);

create or replace function sales.account_label(p_tenant bigint, p_account bigint) returns text language sql stable as $fn$ SELECT CASE WHEN enabled THEN 'ACTIVE' ELSE NULL END FROM sales.accounts WHERE tenant_id=p_tenant AND id=p_account $fn$;

create or replace function sales.audit_amount() returns trigger language plpgsql volatile as $fn$
BEGIN
 IF OLD.amount IS DISTINCT FROM NEW.amount THEN
  INSERT INTO sales.order_audit VALUES(NEW.tenant_id,NEW.id,OLD.amount,NEW.amount);
 END IF;
 RETURN NEW;
END $fn$;

create or replace function sales.order_projection(p_tenant bigint, p_id bigint) returns TABLE(tenant_id bigint, order_id bigint, account_id bigint, status text, amount numeric) language sql stable as $fn$ SELECT tenant_id,id,account_id,status,amount FROM sales.orders WHERE tenant_id=p_tenant AND id=p_id $fn$;

create or replace function sales.release_label(p_tenant bigint, p_id bigint) returns text language sql stable as $fn$ SELECT CASE WHEN amount>=100 THEN 'MANUAL_REVIEW' ELSE 'STANDARD' END FROM sales.orders WHERE tenant_id=p_tenant AND id=p_id $fn$;

CREATE TRIGGER order_amount_audit AFTER UPDATE OF amount ON sales.orders FOR EACH ROW EXECUTE FUNCTION sales.audit_amount();

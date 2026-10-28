set check_function_bodies = false;

create schema if not exists sales;

create table sales.accounts (
  tenant_id bigint not null,
  id bigint not null,
  enabled boolean not null,
  constraint accounts_pkey PRIMARY KEY (tenant_id, id)
);

create table sales.orders (
  tenant_id bigint not null,
  id bigint not null,
  account_id bigint,
  status text,
  amount numeric(20,6),
  constraint orders_pkey PRIMARY KEY (tenant_id, id)
);

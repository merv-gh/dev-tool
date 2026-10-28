set check_function_bodies = false;

create schema if not exists pay;

create schema if not exists risk;

create table pay.payments (
  tenant_id bigint not null,
  order_id bigint not null,
  status text,
  amount numeric(20,6),
  constraint payments_pkey PRIMARY KEY (tenant_id, order_id)
);

create table risk.accounts (
  tenant_id bigint not null,
  id bigint not null,
  status text,
  credit_limit numeric(20,6),
  constraint accounts_pkey PRIMARY KEY (tenant_id, id)
);

set check_function_bodies = false;

create schema if not exists sales;

create table sales.orders (
  id bigint not null,
  tenant_id bigint not null,
  customer_id bigint not null,
  email text not null,
  tags text[] not null,
  constraint orders_pk PRIMARY KEY (id)
);

create table sales.customers (
  tenant_id bigint not null,
  id bigint not null,
  email text not null,
  constraint customers_pk PRIMARY KEY (tenant_id, id)
);

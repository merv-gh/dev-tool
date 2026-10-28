set check_function_bodies = false;

create schema if not exists pay;

create table pay.payments (
  id bigint not null,
  order_id bigint not null,
  status text not null,
  amount numeric(12,2) not null,
  constraint payments_pk PRIMARY KEY (id)
);

create table pay.d_status (
  code text not null,
  constraint d_status_pk PRIMARY KEY (code)
);

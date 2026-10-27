create table if not exists sales.orders (id bigint primary key, status text);
CREATE TABLE sales.order_items (id bigint, order_id bigint);

alter table sales.orders add constraint order_customer_fk FOREIGN KEY (tenant_id, customer_id) REFERENCES sales.customers(tenant_id, id);

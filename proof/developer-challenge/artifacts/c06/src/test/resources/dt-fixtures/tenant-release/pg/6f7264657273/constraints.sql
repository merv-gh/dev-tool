alter table sales.orders add constraint orders_tenant_id_account_id_fkey FOREIGN KEY (tenant_id, account_id) REFERENCES sales.accounts(tenant_id, id);

set standard_conforming_strings = on;

insert into "sales"."accounts" ("tenant_id", "id", "enabled") overriding system value values ('11', '7', true);

insert into "sales"."accounts" ("tenant_id", "id", "enabled") overriding system value values ('22', '7', true);

insert into "sales"."orders" ("tenant_id", "id", "account_id", "status", "amount") overriding system value values ('11', '420', '7', 'PAID', '17.000001');

insert into "sales"."orders" ("tenant_id", "id", "account_id", "status", "amount") overriding system value values ('22', '420', '7', 'PAID', '100.000001');

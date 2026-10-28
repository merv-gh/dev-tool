set standard_conforming_strings = on;

insert into "pay"."payments" ("tenant_id", "order_id", "status", "amount") overriding system value values ('11', '420', 'PENDING', '17.000001');

insert into "pay"."payments" ("tenant_id", "order_id", "status", "amount") overriding system value values ('22', '420', 'PENDING', '100.000001');

insert into "risk"."accounts" ("tenant_id", "id", "status", "credit_limit") overriding system value values ('11', '7', 'BLOCKED', '1000.000000');

insert into "risk"."accounts" ("tenant_id", "id", "status", "credit_limit") overriding system value values ('22', '7', 'APPROVED', '150.000001');

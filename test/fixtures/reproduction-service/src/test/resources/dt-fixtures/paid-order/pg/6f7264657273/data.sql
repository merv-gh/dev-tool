set standard_conforming_strings = on;

insert into "sales"."customers" ("tenant_id", "id", "email") overriding system value values (7, 9, 'u69b1145a03@example.invalid');

insert into "sales"."orders" ("id", "tenant_id", "customer_id", "email", "tags") overriding system value values (42, 7, 9, 'u69b1145a03@example.invalid', ARRAY['paid', 'demo']::text[]);

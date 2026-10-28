set standard_conforming_strings = on;

insert into "pay"."d_status" ("code") overriding system value values ('PAID');

insert into "pay"."payments" ("id", "order_id", "status", "amount") overriding system value values (80, 42, 'PAID', '12.50');

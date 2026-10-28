alter table pay.payments add constraint payment_status_fk FOREIGN KEY (status) REFERENCES pay.d_status(code);

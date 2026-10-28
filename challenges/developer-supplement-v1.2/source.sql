CREATE TABLE IF NOT EXISTS sales.order_audit(tenant_id bigint,order_id bigint,old_amount numeric(20,6),new_amount numeric(20,6));
CREATE OR REPLACE FUNCTION sales.order_projection(p_tenant bigint,p_id bigint)
RETURNS TABLE(tenant_id bigint,order_id bigint,account_id bigint,status text,amount numeric(20,6))
LANGUAGE sql STABLE AS $$ SELECT tenant_id,id,account_id,status,amount FROM sales.orders WHERE tenant_id=p_tenant AND id=p_id $$;
CREATE OR REPLACE FUNCTION sales.account_label(p_tenant bigint,p_account bigint) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT CASE WHEN enabled THEN 'ACTIVE' ELSE NULL END FROM sales.accounts WHERE tenant_id=p_tenant AND id=p_account $$;
CREATE OR REPLACE FUNCTION sales.release_label(p_tenant bigint,p_id bigint) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT CASE WHEN amount>=100 THEN 'MANUAL_REVIEW' ELSE 'STANDARD' END FROM sales.orders WHERE tenant_id=p_tenant AND id=p_id $$;
CREATE OR REPLACE FUNCTION sales.adjust_amount(p_tenant bigint,p_id bigint,p_amount numeric) RETURNS void
LANGUAGE sql AS $$ UPDATE sales.orders SET amount=p_amount WHERE tenant_id=p_tenant AND id=p_id $$;
CREATE OR REPLACE FUNCTION sales.audit_amount() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.amount IS DISTINCT FROM NEW.amount THEN
  INSERT INTO sales.order_audit VALUES(NEW.tenant_id,NEW.id,OLD.amount,NEW.amount);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_amount_audit ON sales.orders;
CREATE TRIGGER order_amount_audit AFTER UPDATE OF amount ON sales.orders FOR EACH ROW EXECUTE FUNCTION sales.audit_amount();
CREATE OR REPLACE VIEW sales.order_amounts AS SELECT tenant_id,id,amount FROM sales.orders;
CREATE OR REPLACE FUNCTION sales.inspect_dynamic(p_column text,p_tenant bigint) RETURNS SETOF text
LANGUAGE plpgsql STABLE AS $$ BEGIN RETURN QUERY EXECUTE format('select %I::text from sales.orders where tenant_id=$1',p_column) USING p_tenant; END $$;

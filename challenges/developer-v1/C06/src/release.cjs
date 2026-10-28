exports.release = async function({orders, billing}, tenantId, orderId) {
  return orders.begin(async o => billing.begin(async b => {
    const [order] = await o.unsafe("select account_id,status,amount::text from sales.orders where tenant_id=$1 and id=$2", [tenantId, orderId]);
    if (!order || order.status !== 'PAID') throw new Error('order not paid');
    const [account] = await o.unsafe("select enabled from sales.accounts where tenant_id=$1 and id=$2", [tenantId, order.account_id]);
    if (!account?.enabled) throw new Error('account disabled');
    const [risk] = await b.unsafe("select status,credit_limit >= $2::numeric as enough from risk.accounts where id=$1 order by tenant_id limit 1", [order.account_id, order.amount]);
    if (!risk || risk.status !== 'APPROVED' || !risk.enough) throw new Error('credit unavailable');
    const [payment] = await b.unsafe("select status,amount=$3::numeric as agrees from pay.payments where tenant_id=$1 and order_id=$2", [tenantId,orderId,order.amount]);
    if (!payment || payment.status !== 'PENDING' || !payment.agrees) throw new Error('payment unavailable');
    await o.unsafe("update sales.orders set status='RELEASED' where tenant_id=$1 and id=$2", [tenantId,orderId]);
    await b.unsafe("update pay.payments set status='CAPTURED' where order_id=$1", [orderId]);
    return {tenantId:String(tenantId),orderId:String(orderId),amount:order.amount,status:'RELEASED'};
  }));
};

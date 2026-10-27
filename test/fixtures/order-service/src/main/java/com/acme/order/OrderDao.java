package com.acme.order;

@Repository
public class OrderDao {
    public List<Long> ids() {
        return jdbc.queryForList("select o.id from sales.orders o " +
            "join sales.order_items i on i.order_id = o.id where o.status = ?", Long.class);
    }
    public void setStatus(long id, String s) {
        jdbc.update("update sales.orders set status = ? where id = ?", s, id);
        jdbc.update("insert into sales.order_history (order_id, status) values (?, ?)", id, s);
        jdbc.queryForObject("select * from sales.fn_order_total(?)", BigDecimal.class, id);
        jdbc.queryForObject("select sales.order_total(?, true)", BigDecimal.class, id);
        jdbc.update("insert into sales.order_history (order_id, status) select id, coalesce(status, 'new') from sales.orders where id = ?", id);
    }
    BigDecimal tax(long id) {
        return new SimpleJdbcCall(dataSource).withFunctionName("calc_tax").executeFunction(BigDecimal.class, id);
    }
    String notSql = "Select one from the list"; // prose, not SQL
}

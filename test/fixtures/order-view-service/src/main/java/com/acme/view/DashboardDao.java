package com.acme.view;

import java.math.BigDecimal;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class DashboardDao {
    private final NamedParameterJdbcTemplate jdbc;

    public DashboardDao(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Total and payment state of one order for the support dashboard. */
    public Map<String, Object> paymentLine(long orderId) {
        return jdbc.queryForMap("select oc.total, oc.last_payment_status from sales.order_card(:id) oc", Map.of("id", orderId));
    }

    public BigDecimal vipDiscount(long orderId) {
        return jdbc.queryForObject("select legacy_discount from sales.order_card(:id)", Map.of("id", orderId), BigDecimal.class);
    }
}

package com.acme.pay;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class BalanceDao {
    private final JdbcTemplate jdbc;

    public BalanceDao(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public BigDecimal balance(long customerId) {
        return jdbc.queryForObject("select pay.customer_balance(?)", BigDecimal.class, customerId);
    }

    public List<Map<String, Object>> countsByStatus() {
        return jdbc.queryForList("select status, count(*) as n from pay.payments group by status order by status");
    }
}

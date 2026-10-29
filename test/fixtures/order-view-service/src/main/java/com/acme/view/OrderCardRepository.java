package com.acme.view;

import java.time.OffsetDateTime;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class OrderCardRepository {
    private static final RowMapper<OrderCard> CARD = (rs, n) -> new OrderCard(
            rs.getLong("order_id"),
            rs.getString("status"),
            rs.getObject("created_at", OffsetDateTime.class),
            rs.getLong("customer_id"),
            rs.getString("customer_name"),
            rs.getString("customer_email"),
            rs.getString("segment"),
            rs.getInt("item_count"),
            rs.getBigDecimal("total"),
            rs.getBigDecimal("total_with_tax"),
            rs.getBigDecimal("legacy_discount"),
            rs.getString("last_payment_status"));

    private final JdbcTemplate jdbc;

    public OrderCardRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<OrderCard> find(long orderId) {
        return jdbc.query("select * from sales.order_card(?)", CARD, orderId).stream().findFirst();
    }
}

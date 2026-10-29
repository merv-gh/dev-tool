package com.acme.view;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class OrderViewServiceTest {
    private static OrderCardRepository returning(OrderCard card) {
        return new OrderCardRepository(null) {
            @Override
            public Optional<OrderCard> find(long orderId) {
                return Optional.of(card);
            }
        };
    }

    @Test
    void toPayIsTotalWithTaxMinusDiscount() {
        OrderCard card = new OrderCard(7, "paid", OffsetDateTime.now(), 3, "Ann", "ann@example.com", "vip", 2,
                new BigDecimal("100.00"), new BigDecimal("120.00"), new BigDecimal("5"), "captured");
        OrderView v = new OrderViewService(returning(card)).view(7);
        assertThat(v.toPay()).isEqualByComparingTo("115.00");
        assertThat(v.contactEmail()).isEqualTo("ann@example.com");
    }
}

package com.acme.orders;

import com.acme.libs.kafka.EventPublisher;
import java.math.BigDecimal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {
    private final OrderRepository orders;
    private final PaymentGateway payments;
    private final EventPublisher events;

    public OrderService(OrderRepository orders, PaymentGateway payments, EventPublisher events) {
        this.orders = orders;
        this.payments = payments;
        this.events = events;
    }

    @Transactional
    public Order place(String customer, BigDecimal amount) {
        Order order = orders.save(new Order(customer, amount));
        payments.authorize(order.getId(), amount);
        events.publish(String.valueOf(order.getId()), "{\"id\":" + order.getId() + ",\"amount\":" + amount + "}");
        return order;
    }

    @Transactional
    public void settle(Long id) {
        Order order = orders.findById(id).orElseThrow();
        order.setStatus("SETTLED");
        orders.save(order);
    }

    public int reconcile() {
        int n = 0;
        for (Order o : orders.findByStatus("NEW")) {
            if ("SETTLED".equals(payments.status(o.getId()))) {
                settle(o.getId());
                n++;
            }
        }
        return n;
    }
}

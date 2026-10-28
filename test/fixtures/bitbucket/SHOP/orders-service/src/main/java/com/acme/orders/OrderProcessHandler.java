package com.acme.orders;

import com.acme.libs.web.ProcessHandler;
import java.math.BigDecimal;
import java.util.Map;
import org.springframework.stereotype.Component;

// "POST /process/order" of the web starter lands here.
@Component
public class OrderProcessHandler implements ProcessHandler {
    private final OrderService service;

    public OrderProcessHandler(OrderService service) {
        this.service = service;
    }

    @Override
    public boolean supports(String type) {
        return "order".equals(type);
    }

    @Override
    public Object process(String type, Map<String, Object> body) {
        Order order = service.place(String.valueOf(body.get("customer")), new BigDecimal(String.valueOf(body.get("amount"))));
        return Map.of("id", String.valueOf(order.getId()), "status", order.getStatus());
    }
}

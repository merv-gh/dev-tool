package com.acme.orders;

import java.math.BigDecimal;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

// The payments service over HTTP.
@Component
public class PaymentGateway {
    private final RestTemplate restTemplate;
    private final String baseUrl;

    public PaymentGateway(RestTemplate restTemplate, @Value("${orders.payments-url}") String baseUrl) {
        this.restTemplate = restTemplate;
        this.baseUrl = baseUrl;
    }

    public String authorize(Long orderId, BigDecimal amount) {
        return restTemplate.postForObject(baseUrl + "/authorize", Map.of("orderId", orderId, "amount", amount), String.class);
    }

    public String status(Long orderId) {
        return restTemplate.getForObject(baseUrl + "/payments/" + orderId, String.class);
    }
}

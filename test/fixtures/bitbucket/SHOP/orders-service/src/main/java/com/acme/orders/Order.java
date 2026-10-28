package com.acme.orders;

import jakarta.persistence.*;
import java.math.BigDecimal;

@Entity
@Table(name = "orders", schema = "shop")
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String customer;

    private BigDecimal amount;

    private String status = "NEW";

    protected Order() {}

    public Order(String customer, BigDecimal amount) {
        this.customer = customer;
        this.amount = amount;
    }

    public Long getId() { return id; }
    public String getCustomer() { return customer; }
    public BigDecimal getAmount() { return amount; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
}

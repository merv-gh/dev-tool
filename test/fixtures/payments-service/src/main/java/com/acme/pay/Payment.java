package com.acme.pay;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.OffsetDateTime;

@Entity
@Table(name = "payments", schema = "pay")
public class Payment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "customer_id", nullable = false)
    private Long customerId;

    private BigDecimal amount;

    private BigDecimal fee;

    @Enumerated(EnumType.STRING)
    private PaymentStatus status = PaymentStatus.NEW;

    @Column(name = "created_at", insertable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected Payment() {}

    public Payment(Long customerId, BigDecimal amount, BigDecimal fee) {
        this.customerId = customerId;
        this.amount = amount;
        this.fee = fee;
    }

    public Long getId() { return id; }
    public Long getCustomerId() { return customerId; }
    public BigDecimal getAmount() { return amount; }
    public BigDecimal getFee() { return fee; }
    public PaymentStatus getStatus() { return status; }
    public void setStatus(PaymentStatus status) { this.status = status; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}

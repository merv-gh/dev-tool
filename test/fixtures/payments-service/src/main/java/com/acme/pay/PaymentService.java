package com.acme.pay;

import java.math.BigDecimal;
import java.util.NoSuchElementException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PaymentService {
    private final PaymentRepository payments;
    private final FeeCalculator fees;
    private final PaymentEvents events;

    public PaymentService(PaymentRepository payments, FeeCalculator fees, PaymentEvents events) {
        this.payments = payments;
        this.fees = fees;
        this.events = events;
    }

    @Transactional
    public Payment create(Long customerId, BigDecimal amount) {
        Payment p = payments.save(new Payment(customerId, amount, fees.fee(amount)));
        events.created(p);
        return p;
    }

    @Transactional
    public Payment settle(Long id) {
        Payment p = payments.findById(id).orElseThrow(() -> new NoSuchElementException("no payment " + id));
        if (p.getStatus() != PaymentStatus.NEW) {
            throw new IllegalStateException("payment " + id + " is " + p.getStatus());
        }
        p.setStatus(PaymentStatus.SETTLED);
        return payments.save(p);
    }

    public Payment get(Long id) {
        return payments.findById(id).orElseThrow(() -> new NoSuchElementException("no payment " + id));
    }
}

package com.acme.pay;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/payments")
public class PaymentController {
    private final PaymentService service;

    public PaymentController(PaymentService service) {
        this.service = service;
    }

    @GetMapping("/{id}")
    public Payment get(@PathVariable Long id) {
        return service.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Payment create(@RequestBody CreatePayment body) {
        return service.create(body.customerId(), body.amount());
    }

    @PostMapping("/{id}/settle")
    public Payment settle(@PathVariable Long id) {
        return service.settle(id);
    }
}

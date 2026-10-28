package com.acme.orders;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ReconcileJob {
    private final OrderService service;

    public ReconcileJob(OrderService service) {
        this.service = service;
    }

    @Scheduled(fixedDelay = 60000)
    public void run() {
        service.reconcile();
    }
}

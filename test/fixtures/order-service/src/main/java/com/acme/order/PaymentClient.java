package com.acme.order;

@FeignClient(name = "payment-service", path = "/payments")
public interface PaymentClient {
    @PostMapping("/charge")
    ChargeResult charge(@RequestBody Charge c);

    @GetMapping(value = {"/{id}", "/by-id/{id}"})
    Payment get(@PathVariable String id);
}

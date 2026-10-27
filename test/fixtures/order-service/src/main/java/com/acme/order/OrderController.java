package com.acme.order;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    // @GetMapping("/commented-out") must not show up
    /* @PostMapping("/also-commented") */

    @GetMapping("/{id}")
    public ResponseEntity<OrderDto> getOrder(@PathVariable Long id) {
        return null;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public OrderDto create(@RequestBody @Valid CreateOrder body) {
        String note = "see http://www.w3.org/2001/XMLSchema"; // ignored url
        return null;
    }

    @RequestMapping(value = "/search", method = RequestMethod.POST)
    public List<OrderDto> search(@RequestBody Query q) { return null; }
}

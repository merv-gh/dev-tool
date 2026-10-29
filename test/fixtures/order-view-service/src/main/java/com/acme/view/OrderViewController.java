package com.acme.view;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/order-view")
public class OrderViewController {
    private final OrderViewService views;

    public OrderViewController(OrderViewService views) {
        this.views = views;
    }

    @GetMapping("/{id}")
    public OrderView get(@PathVariable long id) {
        return views.view(id);
    }
}

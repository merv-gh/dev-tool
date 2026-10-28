package com.acme.billing.api;

import com.acme.billing.core.InvoiceCalculator;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/invoices")
public class InvoiceController {
    private final InvoiceCalculator calculator;

    public InvoiceController(InvoiceCalculator calculator) {
        this.calculator = calculator;
    }

    @PostMapping("/total")
    public Map<String, BigDecimal> total(@RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<Number> lines = (List<Number>) body.get("lines");
        int discount = ((Number) body.getOrDefault("discount", 0)).intValue();
        BigDecimal total = calculator.total(lines.stream().map(n -> new BigDecimal(n.toString())).toList(), discount, new BigDecimal("0.20"));
        return Map.of("total", total);
    }
}

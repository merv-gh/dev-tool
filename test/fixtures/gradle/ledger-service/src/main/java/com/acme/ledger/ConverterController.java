package com.acme.ledger;

import java.math.BigDecimal;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/convert")
public class ConverterController {
    private final Converter converter;

    public ConverterController(Converter converter) {
        this.converter = converter;
    }

    @GetMapping
    public Map<String, Object> convert(@RequestParam BigDecimal amount, @RequestParam String from, @RequestParam String to) {
        return Map.of("amount", converter.convert(amount, from, to), "currency", to);
    }
}

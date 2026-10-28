package com.acme.libs.web;

import com.acme.libs.audit.AuditTrail;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/process")
public class ProcessController {
    private final List<ProcessHandler> handlers;
    private final AuditTrail audit;

    public ProcessController(List<ProcessHandler> handlers, AuditTrail audit) {
        this.handlers = handlers;
        this.audit = audit;
    }

    @PostMapping("/{type}")
    public Object process(@PathVariable String type, @RequestBody Map<String, Object> body) {
        ProcessHandler handler = handlers.stream().filter(h -> h.supports(type)).findFirst()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "no handler for " + type));
        Object result = handler.process(type, body);
        audit.record(type);
        return result;
    }
}

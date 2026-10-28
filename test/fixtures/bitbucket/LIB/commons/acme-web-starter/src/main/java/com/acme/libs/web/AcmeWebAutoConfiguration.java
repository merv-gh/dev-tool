package com.acme.libs.web;

import com.acme.libs.audit.AuditTrail;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Import;

@AutoConfiguration
@Import({ProcessController.class, AuditTrail.class})
public class AcmeWebAutoConfiguration {
}

package com.acme.libs.web;

import java.util.Map;

// Services implement this; the starter's controller picks the handler for a request type.
public interface ProcessHandler {
    boolean supports(String type);

    Object process(String type, Map<String, Object> body);
}

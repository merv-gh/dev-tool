package com.acme.libs

@RestController
@RequestMapping("/internal")
class InfoController {
    @GetMapping("/info")
    fun info(): Map<String, String> = mapOf()
}

@Component
class LibEvents {
    @KafkaListener(topics = ["lib_events"], groupId = "lib")
    fun on(msg: String) {}
}

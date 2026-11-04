package example;
import org.springframework.web.bind.annotation.*;
import org.springframework.kafka.core.KafkaTemplate;
@RestController
public class AuditController {
    private final KafkaTemplate<String,String> kafka;
    public AuditController(KafkaTemplate<String,String> kafka) { this.kafka = kafka; }
    @PostMapping("/audit")
    public void accept(@RequestBody String message) { kafka.send("audit.received", message); }
}

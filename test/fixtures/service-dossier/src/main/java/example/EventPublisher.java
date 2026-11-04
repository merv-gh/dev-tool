package example;
import org.springframework.stereotype.Service;
import org.springframework.kafka.core.KafkaTemplate;
@Service
public class EventPublisher {
    private final KafkaTemplate<String,Order> kafka;
    public EventPublisher(KafkaTemplate<String,Order> kafka) { this.kafka = kafka; }
    public void send(Order order) { kafka.send("refund.approved", order); }
}

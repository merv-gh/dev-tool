package example;
import org.springframework.stereotype.Component;
import org.springframework.kafka.annotation.KafkaListener;
@Component
public class RefundListener {
    private final CheckoutService service;
    public RefundListener(CheckoutService service) { this.service = service; }
    @KafkaListener(topics="refund.requested")
    public void consume(Order order) { service.handle(order); }
}

package fixture;
import org.springframework.kafka.annotation.KafkaListener;
public class OtherListener {
  @KafkaListener(topics = "person.changed")
  public void consume(Long id) { }
}

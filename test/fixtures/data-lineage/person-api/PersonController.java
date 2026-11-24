package fixture;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
@RestController
public class PersonController extends AbstractPersonController {
  private KafkaTemplate<String, Long> kafkaTemplate;
  private JdbcTemplate jdbc;
  @PostMapping("/person/update")
  public void update(Long id) {
    jdbc.update("call public.rename_person(?)", id);
    kafkaTemplate.send("person.changed", id);
  }
}

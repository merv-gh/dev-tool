package fixture;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.mapping.IndexCoordinates;
public class SearchListener {
  private ElasticsearchOperations elastic;
  @KafkaListener(topics = "person.changed")
  public void consume(Long id) {
    savePerson(id);
  }
  public void savePerson(Long id) {
    elastic.save(id, IndexCoordinates.of("people-search"));
  }
}

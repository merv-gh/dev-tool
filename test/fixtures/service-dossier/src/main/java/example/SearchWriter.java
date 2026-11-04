package example;
import org.springframework.stereotype.Service;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
@Service
public class SearchWriter {
    private final ElasticsearchOperations search;
    public SearchWriter(ElasticsearchOperations search) { this.search = search; }
    public void save(Order order) { search.save(order); }
}

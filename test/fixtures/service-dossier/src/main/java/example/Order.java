package example;
import org.springframework.data.elasticsearch.annotations.Document;
@Document(indexName="refund-search")
public record Order(long id) {}

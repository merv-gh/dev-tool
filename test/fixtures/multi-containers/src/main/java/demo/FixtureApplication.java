package demo;

import java.sql.*;
import java.util.*;
import org.apache.kafka.clients.producer.*;
import org.apache.kafka.common.serialization.StringSerializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.web.bind.annotation.*;

@SpringBootConfiguration
@EnableAutoConfiguration(exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration.class)
public class FixtureApplication {
    @Bean(destroyMethod = "close")
    KafkaProducer<String,String> producer(@Value("${fixture.kafka}") String bootstrap) {
        Properties p = new Properties(); p.put("bootstrap.servers", bootstrap);
        p.put("key.serializer", StringSerializer.class.getName()); p.put("value.serializer", StringSerializer.class.getName());
        p.put("acks", "all"); p.put("max.block.ms", "15000"); p.put("delivery.timeout.ms", "15000"); p.put("request.timeout.ms", "10000");
        return new KafkaProducer<>(p);
    }
    @RestController
    static class QuoteApi {
        final org.springframework.core.env.Environment env;
        final KafkaProducer<String,String> producer;
        QuoteApi(org.springframework.core.env.Environment env, KafkaProducer<String,String> producer) { this.env=env; this.producer=producer; }
        @PostMapping("/quotes")
        Map<String,Object> quote(@RequestBody Map<String,Object> request) throws Exception {
            String id = (String)request.get("id");
            int total = Quote.builder().subtotal(((Number)request.get("subtotal")).intValue()).build().total(true);
            int n = Integer.parseInt(env.getRequiredProperty("fixture.databases"));
            for (int i=0;i<n;i++) try(Connection db=DriverManager.getConnection(env.getRequiredProperty("fixture.pg."+i+".url"),env.getRequiredProperty("fixture.pg."+i+".user"),env.getRequiredProperty("fixture.pg."+i+".password")); PreparedStatement statement=db.prepareStatement("insert into observations(id,total) values (?,?)")) {
                statement.setString(1,id); statement.setInt(2,total); statement.executeUpdate();
            }
            producer.send(new ProducerRecord<>(env.getRequiredProperty("fixture.topic"),id,id+":"+total)).get(15,java.util.concurrent.TimeUnit.SECONDS);
            return Map.of("id",id,"total",total,"databases",n);
        }
    }
}

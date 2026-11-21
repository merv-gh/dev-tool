package demo;

import java.sql.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.*;
import org.springframework.context.event.*;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.*;
import org.springframework.test.context.support.AbstractTestExecutionListener;
import static org.junit.jupiter.api.Assertions.*;

@Tag("multi-container")
@SpringBootTest(classes=FixtureApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ContextConfiguration(initializers=FlowTest.ContextTiming.class)
@TestExecutionListeners(listeners=FlowTest.Dependencies.class,mergeMode=TestExecutionListeners.MergeMode.MERGE_WITH_DEFAULTS)
abstract class FlowTest {
    @Autowired TestRestTemplate http;
    @DynamicPropertySource static void properties(DynamicPropertyRegistry properties) {
        MultiContainerSupport.Binding binding=MultiContainerSupport.current;
        if(binding==null)throw new IllegalStateException("Dependencies must be ready before Spring properties");
        properties.add("fixture.databases",()->binding.pg.size());properties.add("fixture.kafka",()->binding.bootstrap);properties.add("fixture.topic",()->binding.topic);
        for(int i=0;i<binding.pg.size();i++){MultiContainerSupport.Pg p=binding.pg.get(i);String prefix="fixture.pg."+i;properties.add(prefix+".url",()->p.url());properties.add(prefix+".user",()->p.user());properties.add(prefix+".password",()->p.password());}
    }
    @Test void httpToEveryDatabaseAndKafka()throws Exception {
        String id=UUID.randomUUID().toString();MultiContainerSupport.Binding binding=MultiContainerSupport.current;
        MultiContainerSupport.measure("flow.http",getClass().getSimpleName(),()->{var response=http.postForEntity("/quotes",Map.of("id",id,"subtotal",20),Map.class);assertEquals(200,response.getStatusCodeValue());assertEquals(30,response.getBody().get("total"));assertEquals(binding.pg.size(),response.getBody().get("databases"));return null;});
        MultiContainerSupport.measure("flow.database.verify",getClass().getSimpleName(),()->{for(var p:binding.pg)try(Connection db=p.connect();PreparedStatement s=db.prepareStatement("select total from observations where id=?")){s.setString(1,id);try(ResultSet rows=s.executeQuery()){assertTrue(rows.next());assertEquals(30,rows.getInt(1));assertFalse(rows.next());}}return null;});
        Properties p=new Properties();p.put("bootstrap.servers",binding.bootstrap);p.put("group.id","dt-"+binding.lease+"-"+id);p.put("key.deserializer",StringDeserializer.class.getName());p.put("value.deserializer",StringDeserializer.class.getName());p.put("auto.offset.reset","earliest");p.put("enable.auto.commit","false");
        MultiContainerSupport.measure("flow.kafka.verify",getClass().getSimpleName(),()->{try(KafkaConsumer<String,String> consumer=new KafkaConsumer<>(p)){var partition=new org.apache.kafka.common.TopicPartition(binding.topic,0);consumer.assign(List.of(partition));consumer.seekToBeginning(List.of(partition));long deadline=System.nanoTime()+Duration.ofSeconds(30).toNanos();boolean found=false;while(!found&&System.nanoTime()<deadline)for(ConsumerRecord<String,String> record:consumer.poll(Duration.ofMillis(250)))if(id.equals(record.key())){assertEquals(id+":30",record.value());found=true;}assertTrue(found,"Expected the HTTP request's actual Kafka record");}return null;});
    }
    public static class Dependencies extends AbstractTestExecutionListener {
        public int getOrder(){return Integer.MIN_VALUE;}
        public void beforeTestClass(TestContext context)throws Exception {MultiContainerSupport.closeContext=()->context.markApplicationContextDirty(DirtiesContext.HierarchyMode.EXHAUSTIVE);MultiContainerSupport.acquire(context.getTestClass().getSimpleName());}
        public void afterTestClass(TestContext context)throws Exception {
            int count=MultiContainerSupport.completed.incrementAndGet();
            if(MultiContainerSupport.config().perClass()||count==MultiContainerSupport.config().classes()){
                context.markApplicationContextDirty(DirtiesContext.HierarchyMode.EXHAUSTIVE);MultiContainerSupport.release();
            }
        }
    }
    public static class ContextTiming implements ApplicationContextInitializer<ConfigurableApplicationContext> {
        public void initialize(ConfigurableApplicationContext context) {
            long start=System.currentTimeMillis(),nano=System.nanoTime();
            context.addApplicationListener((ApplicationListener<ApplicationEvent>)event->{if(event instanceof ContextRefreshedEvent refreshed&&refreshed.getApplicationContext()==context)MultiContainerSupport.event("spring.context.refresh","application",start,Math.round((System.nanoTime()-nano)/1e6),"ok",Map.of());});
        }
    }
}
class FirstFlowTest extends FlowTest {}
class SecondFlowTest extends FlowTest {}
class ThirdFlowTest extends FlowTest {}

package demo;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class SupportPolicyTest {
    @Test void workspaceRejectsAnotherOwnerBeforeNetworkAccess()throws Exception {
        var file=java.nio.file.Files.createTempFile("dt-fixture-bindings-",".json");
        var priorConfig=MultiContainerSupport.config;
        try {
            java.nio.file.Files.writeString(file,"{\"owner\":\"another-owner\",\"databases\":[]}");
            MultiContainerSupport.config=new MultiContainerSupport.Config("owned123","workspace",2,3,2,30,"postgres:16-alpine","apache/kafka:3.8.0",file.toString());
            var failure=assertThrows(IllegalArgumentException.class,()->MultiContainerSupport.acquire("owner-regression"));
            assertEquals("Pool owner or database count mismatch",failure.getMessage());
            assertNull(MultiContainerSupport.current);
        }finally {MultiContainerSupport.config=priorConfig;java.nio.file.Files.deleteIfExists(file);}
    }
    @Test void startupTelemetryDoesNotNeedTheLifecycleMonitor()throws Exception {
        var file=java.nio.file.Files.createTempFile("dt-fixture-events-",".jsonl");
        String previous=System.getProperty("dt.fixture.events");var priorConfig=MultiContainerSupport.config;
        ExecutorService worker=Executors.newSingleThreadExecutor();
        try {
            System.setProperty("dt.fixture.events",file.toString());
            MultiContainerSupport.config=MultiContainerSupport.Config.parse(MultiContainerSupport.JSON.readTree("{\"run\":\"owned123\",\"mode\":\"suite-parallel\"}"));
            synchronized(MultiContainerSupport.class) {
                worker.submit(()->MultiContainerSupport.event("container.start","regression",0,1,"ok",Map.of())).get(5,TimeUnit.SECONDS);
            }
            var rows=java.nio.file.Files.readAllLines(file);assertEquals(1,rows.size());
            assertEquals("container.start",MultiContainerSupport.JSON.readTree(rows.get(0)).path("operation").asText());
        }finally {
            worker.shutdownNow();MultiContainerSupport.config=priorConfig;
            if(previous==null)System.clearProperty("dt.fixture.events");else System.setProperty("dt.fixture.events",previous);
            java.nio.file.Files.deleteIfExists(file);
        }
    }
    @Test void explicitModeAndLimitsAreValidated()throws Exception {
        assertThrows(IllegalArgumentException.class,()->MultiContainerSupport.Config.parse(MultiContainerSupport.JSON.readTree("{\"run\":\"owned123\",\"mode\":\"workspace\"}")));
        assertThrows(IllegalArgumentException.class,()->MultiContainerSupport.Config.parse(MultiContainerSupport.JSON.readTree("{\"run\":\"owned123\",\"mode\":\"suite-parallel\",\"parallelism\":100}")));
        var c=MultiContainerSupport.Config.parse(MultiContainerSupport.JSON.readTree("{\"run\":\"owned123\",\"mode\":\"suite-parallel\",\"databases\":3,\"parallelism\":2,\"timeoutSeconds\":45}"));
        assertEquals(3,c.databases());assertEquals(2,c.parallelism());assertEquals(45,c.timeoutSeconds());assertFalse(c.perClass());
    }
    @Test void concurrencyIsBoundedAndFailedStartsDrainBeforeCompensation()throws Exception {
        CountDownLatch entered=new CountDownLatch(2),release=new CountDownLatch(1);AtomicInteger active=new AtomicInteger(),peak=new AtomicInteger(),completed=new AtomicInteger();List<Runnable> actions=new ArrayList<>();
        for(int i=0;i<5;i++){final int index=i;actions.add(()->{int n=active.incrementAndGet();peak.accumulateAndGet(n,Math::max);entered.countDown();try{assertTrue(release.await(5,TimeUnit.SECONDS));if(index==0)throw new IllegalStateException("Synthetic failed start");}catch(InterruptedException e){throw new RuntimeException(e);}finally{active.decrementAndGet();completed.incrementAndGet();}});}
        ExecutorService worker=Executors.newSingleThreadExecutor();try{Future<?> result=worker.submit(()->MultiContainerSupport.startBatch(actions,2));assertTrue(entered.await(5,TimeUnit.SECONDS));assertEquals(2,peak.get());assertFalse(result.isDone());release.countDown();assertThrows(ExecutionException.class,()->result.get(5,TimeUnit.SECONDS));assertEquals(5,completed.get());assertEquals(0,active.get());assertEquals(2,peak.get());}finally{release.countDown();worker.shutdownNow();}
    }
}

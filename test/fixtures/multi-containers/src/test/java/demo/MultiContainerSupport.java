package demo;

import com.fasterxml.jackson.databind.*;
import java.io.*;
import java.nio.file.*;
import java.sql.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.kafka.clients.admin.*;
import org.testcontainers.containers.*;
import org.testcontainers.kafka.KafkaContainer;
import org.testcontainers.utility.DockerImageName;

/** Test-support prototype: explicit providers, bounded startup, owned resources. */
final class MultiContainerSupport {
    static final ObjectMapper JSON = new ObjectMapper();
    static final Object EVENTS_LOCK = new Object();
    static final AtomicInteger completed = new AtomicInteger();
    static Binding current;
    static Config config;
    static Runnable closeContext=()->{};
    static boolean hookInstalled;
    static Config config() {
        if(config==null) try { config=Config.read(Path.of(System.getProperty("dt.fixture.config"))); }
        catch(IOException e) { throw new IllegalStateException("Cannot read fixture configuration",e); }
        return config;
    }
    record Config(String run, String mode, int databases, int classes, int parallelism, int timeoutSeconds, String postgresImage, String kafkaImage, String bindings) {
        static Config read(Path path) throws IOException { return parse(JSON.readTree(path.toFile())); }
        static Config parse(JsonNode n) {
            String run=n.path("run").asText(),mode=n.path("mode").asText();
            if(!run.matches("[a-z][a-z0-9]{5,30}"))throw new IllegalArgumentException("Invalid owned run id");
            if(!Set.of("per-class-sequential","per-class-parallel","suite-parallel","workspace").contains(mode))throw new IllegalArgumentException("Unknown provider mode");
            int databases=n.path("databases").asInt(2),classes=n.path("classes").asInt(3),parallelism=n.path("parallelism").asInt(3),timeout=n.path("timeoutSeconds").asInt(180);
            if(databases<1||databases>4||classes<1||classes>30||parallelism<1||parallelism>8||timeout<5||timeout>600)throw new IllegalArgumentException("Invalid resource/time limits");
            String bindings=n.path("bindings").asText("");if(mode.equals("workspace")&&bindings.isBlank())throw new IllegalArgumentException("Workspace provider requires explicit owned pool bindings");
            return new Config(run,mode,databases,classes,parallelism,timeout,n.path("postgresImage").asText("postgres:16-alpine"),n.path("kafkaImage").asText("apache/kafka:3.8.0"),bindings);
        }
        boolean perClass() { return mode.startsWith("per-class-"); }
    }
    @FunctionalInterface interface Action<T> { T run() throws Exception; }
    static <T>T measure(String operation,String resource,Action<T> action) throws Exception {
        long start=System.currentTimeMillis(),nano=System.nanoTime();Throwable failure=null;
        try{return action.run();}catch(Exception|Error e){failure=e;throw e;}
        finally { event(operation,resource,start,Math.round((System.nanoTime()-nano)/1e6),failure==null?"ok":"failed",failure==null?Map.of():Map.of("errorType",failure.getClass().getSimpleName())); }
    }
    static void event(String operation,String resource,long start,long ms,String outcome,Map<String,?> extra) {
        synchronized(EVENTS_LOCK) { try {
            Path file=Path.of(System.getProperty("dt.fixture.events"));Files.createDirectories(file.getParent());
            Map<String,Object> row=new LinkedHashMap<>();row.put("protocol","dt.dependency-measurement/v1");row.put("run",config().run);row.put("mode",config().mode);row.put("pid",ProcessHandle.current().pid());row.put("operation",operation);row.put("resource",resource);row.put("start",start);row.put("ms",ms);row.put("outcome",outcome);row.putAll(extra);
            try(var channel=java.nio.channels.FileChannel.open(file,StandardOpenOption.CREATE,StandardOpenOption.WRITE);var lock=channel.lock()) {
                channel.position(channel.size());var data=java.nio.ByteBuffer.wrap((JSON.writeValueAsString(row)+"\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                while(data.hasRemaining())channel.write(data);
            }
        }catch(IOException e){throw new UncheckedIOException(e);} }
    }
    static void startBatch(List<Runnable> actions,int parallelism) {
        ExecutorService executor=Executors.newFixedThreadPool(parallelism);
        try {
            List<CompletableFuture<Void>> jobs=actions.stream().map(a->CompletableFuture.runAsync(a,executor)).toList();
            // allOf drains every start before cleanup; a failing sibling cannot race a later create.
            CompletableFuture.allOf(jobs.toArray(CompletableFuture[]::new)).join();
        }finally {executor.shutdown();}
    }
    record Pg(String url,String user,String password) {
        Connection connect() throws SQLException { return DriverManager.getConnection(url,user,password); }
        Pg maintenance() { return new Pg(url.substring(0,url.lastIndexOf('/')+1)+"postgres",user,password); }
    }
    static final class OwnedSet implements AutoCloseable {
        final List<PostgreSQLContainer<?>> pg=new ArrayList<>(); final KafkaContainer kafka;
        OwnedSet(Config c) {
            for(int i=0;i<c.databases;i++)pg.add(new PostgreSQLContainer<>(DockerImageName.parse(c.postgresImage)).withDatabaseName("fixturebase").withLabel("dt.benchmark.owner",c.run).withStartupTimeout(Duration.ofSeconds(c.timeoutSeconds)));
            // TC 1.20.4 waits for the starter file to exist, then executes it while
            // Docker may still be extracting it (intermittent ETXTBSY). Signal
            // readiness only after the starter upload has completed.
            kafka=new KafkaContainer(DockerImageName.parse(c.kafkaImage)) {
                @Override protected void containerIsStarting(com.github.dockerjava.api.command.InspectContainerResponse info) {
                    super.containerIsStarting(info);
                    copyFileToContainer(org.testcontainers.images.builder.Transferable.of("ready\n",0644),"/tmp/dt-kafka-starter-ready");
                }
            }.withCommand("sh","-c","while [ ! -f /tmp/dt-kafka-starter-ready ]; do sleep 0.1; done; exec bash /tmp/testcontainers_start.sh")
             .withLabel("dt.benchmark.owner",c.run).withStartupTimeout(Duration.ofSeconds(c.timeoutSeconds));
        }
        List<GenericContainer<?>> containers() { List<GenericContainer<?>> all=new ArrayList<>(pg);all.add(kafka);return all; }
        void start(int concurrency) throws Exception {
            List<Runnable> actions=new ArrayList<>();int i=0;
            for(GenericContainer<?> container:containers()) {String id=container==kafka?"kafka":"postgres-"+(i++);actions.add(()->{try {measure("container.start",id,()->{container.start();return null;});event("container.identity",id,System.currentTimeMillis(),0,"ok",Map.of("containerId",container.getContainerId(),"image",container.getDockerImageName(),"imageId",container.getContainerInfo().getImageId()));}catch(Exception e){throw new CompletionException(e);}});}
            try {measure("dependencies.start","set",()->{startBatch(actions,concurrency);return null;});for(i=0;i<pg.size();i++){int index=i;measure("database.template","postgres-"+i,()->{try(Connection db=pg(index).connect();Statement s=db.createStatement()){s.execute("create table observations(id text primary key,total integer not null)");}return null;});}}
            catch(Exception|Error e){try{close();}catch(Exception cleanup){e.addSuppressed(cleanup);}throw e;}
        }
        Pg pg(int index) { PostgreSQLContainer<?> p=pg.get(index);return new Pg(p.getJdbcUrl(),p.getUsername(),p.getPassword()); }
        public void close() throws Exception {
            Exception failed=null;List<GenericContainer<?>> all=containers();Collections.reverse(all);
            for(GenericContainer<?> container:all)try {measure("container.stop",container==kafka?"kafka":"postgres",()->{container.stop();return null;});}catch(Exception e){if(failed==null)failed=e;else failed.addSuppressed(e);}
            if(failed!=null)throw failed;
        }
    }
    static synchronized Binding acquire(String testClass) throws Exception {
        if(current!=null)return current;
        if(!hookInstalled){hookInstalled=true;Runtime.getRuntime().addShutdownHook(new Thread(()->{try{closeContext.run();release();}catch(Exception e){event("cleanup.failure","shutdown",System.currentTimeMillis(),0,"failed",Map.of("errorType",e.getClass().getSimpleName()));}},"dt-fixture-cleanup"));}
        Config c=config();String lease=c.run+UUID.randomUUID().toString().replace("-","").substring(0,8);
        current=new Binding(lease);
        try {
            if(c.mode.equals("workspace")){
                JsonNode pool=JSON.readTree(Path.of(c.bindings).toFile());
                if(!pool.path("owner").asText().equals(c.run)||pool.path("databases").size()!=c.databases)throw new IllegalArgumentException("Pool owner or database count mismatch");
                current.bootstrap=pool.path("kafka").asText();
                for(JsonNode p:pool.path("databases")){
                    Pg template=new Pg(p.path("url").asText(),p.path("user").asText(),p.path("password").asText());Pg parent=template.maintenance();String name="dt_"+lease+"_"+current.pg.size();
                    measure("database.clone",name,()->{try(Connection db=parent.connect();Statement s=db.createStatement()){s.execute("create database \""+name+"\" template fixturebase");}return null;});
                    current.parents.add(parent);current.names.add(name);current.pg.add(new Pg(template.url.substring(0,template.url.lastIndexOf('/')+1)+name,template.user,template.password));
                }
            }else{
                current.owned=new OwnedSet(c);current.owned.start(c.mode.equals("per-class-sequential")?1:c.parallelism);
                current.bootstrap=current.owned.kafka.getBootstrapServers();for(int i=0;i<c.databases;i++)current.pg.add(current.owned.pg(i));
            }
            current.topic="dt-"+lease;
            Binding binding=current;
            measure("kafka.topic.create",binding.topic,()->{try(AdminClient admin=admin(binding.bootstrap)){admin.createTopics(List.of(new NewTopic(binding.topic,1,(short)1))).all().get(c.timeoutSeconds,TimeUnit.SECONDS);}return null;});
            for(Pg p:current.pg)try(Connection db=p.connect();Statement s=db.createStatement();ResultSet rows=s.executeQuery("select count(*) from observations")){rows.next();if(rows.getInt(1)!=0)throw new IllegalStateException("New dependency lease contains another run's data");}
            event("dependencies.bound",testClass,System.currentTimeMillis(),0,"ok",Map.of("lease",lease,"databases",c.databases,"databaseNames",List.copyOf(current.names),"topic",current.topic));
            return current;
        }catch(Exception|Error e){try{release();}catch(Exception cleanup){e.addSuppressed(cleanup);}throw e;}
    }
    static AdminClient admin(String bootstrap){return AdminClient.create(Map.of("bootstrap.servers",bootstrap,"request.timeout.ms","10000","default.api.timeout.ms","15000"));}
    static final class Binding implements AutoCloseable {
        final String lease;final List<Pg> pg=new ArrayList<>(),parents=new ArrayList<>();final List<String> names=new ArrayList<>();String bootstrap,topic;OwnedSet owned;
        Binding(String lease){this.lease=lease;}
        public void close()throws Exception {
            Exception failed=null;
            try {if(topic!=null)measure("kafka.topic.delete",topic,()->{try(AdminClient a=admin(bootstrap)){a.deleteTopics(List.of(topic)).all().get(20,TimeUnit.SECONDS);}return null;});}catch(Exception e){failed=e;}
            for(int i=0;i<parents.size();i++){Pg parent=parents.get(i);String name=names.get(i);try{measure("database.drop",name,()->{try(Connection db=parent.connect();PreparedStatement terminate=db.prepareStatement("select pg_terminate_backend(pid) from pg_stat_activity where datname=? and pid<>pg_backend_pid()")){terminate.setString(1,name);terminate.execute();try(Statement drop=db.createStatement()){drop.execute("drop database \""+name+"\"");}}return null;});}catch(Exception e){if(failed==null)failed=e;else failed.addSuppressed(e);}}
            try{if(owned!=null)owned.close();}catch(Exception e){if(failed==null)failed=e;else failed.addSuppressed(e);}if(failed!=null)throw failed;
        }
    }
    static synchronized void release()throws Exception {if(current!=null){Binding prior=current;current=null;prior.close();}}

    /** Keeps infrastructure alive across separate Gradle/test JVM invocations. */
    public static void main(String[] args)throws Exception {
        config();try(OwnedSet pool=new OwnedSet(config())){
            pool.start(config().parallelism);List<Map<String,String>> db=new ArrayList<>();for(int i=0;i<config().databases;i++){Pg p=pool.pg(i);db.add(Map.of("url",p.url,"user",p.user,"password",p.password));}
            Path dest=Path.of(config().bindings);Files.createDirectories(dest.getParent());
            try{Files.createFile(dest,java.nio.file.attribute.PosixFilePermissions.asFileAttribute(java.nio.file.attribute.PosixFilePermissions.fromString("rw-------")));}catch(FileAlreadyExistsException ignored){}
            Files.writeString(dest,JSON.writeValueAsString(Map.of("owner",config().run,"databases",db,"kafka",pool.kafka.getBootstrapServers())));
            System.out.println("DT_POOL_READY");System.out.flush();System.in.read();
        }
    }
}

// Build/transport provisioning for supplementary refactor tests. Does not refactor the consumer.
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const prepared=path.resolve(process.argv[2]||'');const s=require(path.join(prepared,'setup.json'));const TOOL=process.env.DT_CHALLENGE_TOOL_ROOT||s.dtRoot;
const dest=path.join(prepared,'supplement/order-projection');if(fs.existsSync(dest))throw new Error('supplement project already exists');
fs.mkdirSync(dest,{recursive:true});fs.cpSync(path.resolve(__dirname,'../developer-supplement-v1.2/src'),path.join(dest,'src'),{recursive:true});
const pom='<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>com.lumen</groupId><artifactId>order-projection</artifactId><version>1.0.0</version><properties><maven.compiler.release>17</maven.compiler.release></properties><dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.0</version><scope>test</scope></dependency><dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId><version>42.7.4</version></dependency></dependencies><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version><configuration><release>17</release></configuration></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.2.5</version></plugin></plugins></build></project>\n';fs.writeFileSync(path.join(dest,'pom.xml'),pom);
const jdbc=`package com.lumen.orders;
import java.sql.*;
import java.util.Map;
import java.util.LinkedHashMap;
public final class JdbcFunctions implements OrderProjectionService.Functions {
 private final String url,user,password;
 public JdbcFunctions(String url,String user,String password){this.url=url;this.user=user;this.password=password;}
 public static JdbcFunctions fromEnvironment(){return new JdbcFunctions(System.getenv("DT_FUNCTIONS_URL"),System.getenv("DT_FUNCTIONS_USERNAME"),System.getenv("DT_FUNCTIONS_PASSWORD"));}
 private Connection connection() throws SQLException{return DriverManager.getConnection(url,user,password);}
 public Map<String,String> projection(String tenant,String orderId){
  try(Connection c=connection();PreparedStatement s=c.prepareStatement("select * from sales.order_projection(?,?)")){
   s.setLong(1,Long.parseLong(tenant));s.setLong(2,Long.parseLong(orderId));
   try(ResultSet r=s.executeQuery()){if(!r.next())return null;Map<String,String> row=new LinkedHashMap<>();for(int i=1;i<=r.getMetaData().getColumnCount();i++)row.put(r.getMetaData().getColumnLabel(i),r.getString(i));return row;}
  }catch(SQLException e){throw new IllegalStateException(e);}
 }
 private String label(String function,String tenant,String id){
  try(Connection c=connection();PreparedStatement s=c.prepareStatement("select sales."+function+"(?,?)")){
   s.setLong(1,Long.parseLong(tenant));s.setLong(2,Long.parseLong(id));try(ResultSet r=s.executeQuery()){return r.next()?r.getString(1):null;}
  }catch(SQLException e){throw new IllegalStateException(e);}
 }
 public String accountLabel(String tenant,String account){return label("account_label",tenant,account);}
 public String releaseLabel(String tenant,String orderId){return label("release_label",tenant,orderId);}
}
`;fs.writeFileSync(path.join(dest,'src/main/java/com/lumen/orders/JdbcFunctions.java'),jdbc);
const git=(...a)=>execFileSync('git',a,{cwd:dest,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'Challenge Setup',GIT_AUTHOR_EMAIL:'setup@example.invalid',GIT_COMMITTER_NAME:'Challenge Setup',GIT_COMMITTER_EMAIL:'setup@example.invalid'}}).trim();git('init','-q','-b','main');git('add','.');git('commit','-qm','Public supplementary consumer and JDBC setup');
s.repos['CASES/order-projection']=dest;fs.writeFileSync(path.join(prepared,'setup.json'),JSON.stringify(s,null,2)+'\n');
process.env.DT_HOME=s.home;for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_REPOS_DIR'])delete process.env[k];
const cfgFile=path.join(s.home,'config.json');const cfg=JSON.parse(fs.readFileSync(cfgFile));const u=new URL(cfg.envs.fixture.postgres.orders);const jdbcUrl='jdbc:postgresql://'+u.hostname+':'+(u.port||5432)+u.pathname;
cfg.tests.env={...cfg.tests.env,DT_FUNCTIONS_URL:jdbcUrl,DT_FUNCTIONS_USERNAME:decodeURIComponent(u.username),DT_FUNCTIONS_PASSWORD:decodeURIComponent(u.password),DT_DATA_SOURCE_ENV:'fixture'};fs.writeFileSync(cfgFile,JSON.stringify(cfg,null,2)+'\n');
const route=path.join(prepared,'git-routing.conf');execFileSync('git',['config','--file',route,`url.file://${dest}.insteadOf`,`${cfg.bitbucket.url}/scm/cases/order-projection.git`]);
const sha=git('rev-parse','HEAD');require(path.join(TOOL,'lib/codeindex')).build(dest,'CASES/order-projection',{project:'CASES',repo:'order-projection',ref:'main',sha});
console.log(JSON.stringify({project:'CASES',repo:'order-projection',ref:'main',sha,localRemote:dest,GIT_CONFIG_GLOBAL:route,build:'Maven/JDK17+ with pinned compiler/Surefire/JUnit and PostgreSQL JDBC',dataEnvironment:'fixture SELECT-only functions via tests.env DT_FUNCTIONS_*',executionTarget:'local build host unless a separate runner is configured',note:'Restarted static fake Bitbucket listing is optional for metadata; direct workspace_open uses task-local Git routing.'},null,2));

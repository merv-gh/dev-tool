import com.lumen.orders.OrderProjectionService;
import com.lumen.orders.JdbcFunctions;
import java.util.*;
public class S03Acceptance {
 static void eq(Object want,Object got){if(!Objects.equals(want,got))throw new AssertionError("expected "+want+" got "+got);}
 static final class Functions implements OrderProjectionService.Functions {
  final List<String> calls=new ArrayList<>();final Map<String,String> row;final boolean absent;final boolean nullable;
  Functions(boolean absent,boolean nullable){this.absent=absent;this.nullable=nullable;Map<String,String> r=new LinkedHashMap<>();r.put("account_id","71");r.put("amount","0.000001");r.put("accountLabel","OLD");row=Collections.unmodifiableMap(r);}
  public Map<String,String> projection(String t,String o){calls.add("projection:"+t+":"+o);return absent?null:row;}
  public String accountLabel(String t,String a){calls.add("account:"+t+":"+a);return nullable?null:"label:"+t+":"+a;}
  public String releaseLabel(String t,String o){calls.add("release:"+t+":"+o);return nullable?null:"release:"+t+":"+o;}
 }
 public static void main(String[] args){
  if(args.length>0&&args[0].equals("jdbc")){
   OrderProjectionService s=new OrderProjectionService(JdbcFunctions.fromEnvironment());
   for(String[] ids:new String[][]{{"11","420"},{"22","420"},{"22","999"}}){Map<String,String> v=s.load(ids[0],ids[1]);System.out.println(ids[0]+":"+ids[1]+":"+(v==null?"null":new TreeMap<>(v)));}return;
  }
  int checked=0;
  for(boolean absent:new boolean[]{false,true})for(boolean nullable:new boolean[]{false,true}){
   Functions f=new Functions(absent,nullable);OrderProjectionService s=new OrderProjectionService(f);Map<String,String> v=s.load("801","9007199254740993");
   if(absent){eq(null,v);eq(List.of("projection:801:9007199254740993"),f.calls);}else{
    eq("0.000001",v.get("amount"));eq(nullable?null:"label:801:71",v.get("accountLabel"));eq(nullable?null:"release:801:9007199254740993",v.get("releaseLabel"));
    if(!v.containsKey("accountLabel")||!v.containsKey("releaseLabel"))throw new AssertionError("nullable enrichment keys missing");
    eq(List.of("projection:801:9007199254740993","account:801:71","release:801:9007199254740993"),f.calls);eq("OLD",f.row.get("accountLabel"));eq(3,f.row.size());if(v==f.row)throw new AssertionError("projection aliased");
   }checked++;
  }System.out.println("PASS "+checked+" independent differential inputs");
 }
}

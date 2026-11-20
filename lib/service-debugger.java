// Run inside an owned JDK container; never evaluates expressions or invokes application methods.
import com.sun.jdi.*;
import com.sun.jdi.connect.*;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;
import com.sun.net.httpserver.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

class ServiceDebugger {
  static VirtualMachine vm;
  static final List<Map<String,Object>> events = new ArrayList<>();
  static final Map<String,Map<String,String>> points = new LinkedHashMap<>();
  static final Map<Long,EventSet> paused = new HashMap<>();
  static final Map<Long,Long> pausedAt = new HashMap<>();
  static long sequence = 0;
  static Map<String,Object> record(Object... pairs) { Map<String,Object> out=new LinkedHashMap<>();for(int i=0;i<pairs.length;i+=2)out.put((String)pairs[i],pairs[i+1]);return out; }
  static String json(Object v) {
    if(v==null)return "null";if(v instanceof Boolean||v instanceof Number)return v.toString();
    if(v instanceof Map<?,?> m){List<String>s=new ArrayList<>();for(var e:m.entrySet())s.add(json(e.getKey().toString())+":"+json(e.getValue()));return "{"+String.join(",",s)+"}";}
    if(v instanceof Iterable<?> xs){List<String>s=new ArrayList<>();for(Object x:xs)s.add(json(x));return "["+String.join(",",s)+"]";}
    String s=v.toString(),out="\"";for(int i=0;i<Math.min(s.length(),4000);i++){char c=s.charAt(i);out+=c=='"'?"\\\"":c=='\\'?"\\\\":c<32?String.format("\\u%04x",(int)c):String.valueOf(c);}return out+"\"";
  }
  static void event(String kind,Map<String,Object> data){data.put("sequence",++sequence);data.put("kind",kind);data.put("at",System.currentTimeMillis());events.add(data);while(events.size()>100)events.remove(0);}
  static void install(String id,Map<String,String> p,ReferenceType type)throws Exception{
    List<Location> locations=new ArrayList<>();if(p.containsKey("method")){for(Method m:type.methodsByName(p.get("method")))if(m.location()!=null)locations.add(m.location());}
    else locations=type.locationsOfLine(Integer.parseInt(p.get("line")));
    if(locations.isEmpty()){event("unresolved",record("breakpoint",id,"class",type.name(),"reason","No executable location / debug line metadata"));return;}
    for(Location location:locations.subList(0,Math.min(16,locations.size()))){BreakpointRequest req=vm.eventRequestManager().createBreakpointRequest(location);req.putProperty("id",id);req.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);req.enable();}
    event("breakpoint-installed",record("breakpoint",id,"class",type.name(),"locations",locations.size()));
  }
  static ThreadReference thread(String id){long number=Long.parseLong(id);return vm.allThreads().stream().filter(t->t.uniqueID()==number).findFirst().orElseThrow(()->new IllegalArgumentException("Thread not found"));}
  static Object value(Value v){if(v==null)return null;if(v instanceof StringReference s){String text=s.value();return text.substring(0,Math.min(1000,text.length()));}if(v instanceof PrimitiveValue)return v.toString();if(v instanceof ObjectReference o)return record("type",o.referenceType().name(),"objectId",o.uniqueID());return v.type().name();}
  static synchronized Object command(Map<String,String> p)throws Exception{
    String action=p.getOrDefault("action","events");
    if(action.equals("breakpoint")){String clazz=p.getOrDefault("class",""),id=p.getOrDefault("id",UUID.randomUUID().toString());if(!clazz.matches("[a-zA-Z_$][\\w$]*(\\.[a-zA-Z_$][\\w$]*)*"))throw new IllegalArgumentException("Exact class name required");if(!p.containsKey("method")&&(!p.containsKey("line")||Integer.parseInt(p.get("line"))<1))throw new IllegalArgumentException("Supply line or method");if(points.size()>=30&&!points.containsKey(id))throw new IllegalArgumentException("Breakpoint budget reached");points.put(id,new HashMap<>(p));ClassPrepareRequest req=vm.eventRequestManager().createClassPrepareRequest();req.addClassFilter(clazz);req.putProperty("id",id);req.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);req.enable();for(ReferenceType type:vm.classesByName(clazz))install(id,p,type);return record("id",id,"class",clazz,"pending",vm.classesByName(clazz).isEmpty());}
    if(action.equals("clear")){String id=p.get("id");points.remove(id);List<EventRequest> requests=new ArrayList<>();requests.addAll(vm.eventRequestManager().breakpointRequests());requests.addAll(vm.eventRequestManager().classPrepareRequests());for(EventRequest r:requests)if(Objects.equals(r.getProperty("id"),id))vm.eventRequestManager().deleteEventRequest(r);return record("removed",id);}
    if(action.equals("events")){long after=Long.parseLong(p.getOrDefault("after","0"));return record("events",events.stream().filter(e->(long)e.get("sequence")>after).toList(),"cursor",sequence,"pausedThreads",new ArrayList<>(paused.keySet()),"pauseLimitMs",60000);}
    if(action.equals("threads")){List<Object> out=new ArrayList<>();for(ThreadReference t:vm.allThreads()){if(out.size()==100)break;out.add(record("id",t.uniqueID(),"name",t.name(),"suspended",t.isSuspended()));}return record("threads",out);}
    if(action.equals("stack")){ThreadReference t=thread(p.get("thread"));if(!t.isSuspended())throw new IllegalArgumentException("Thread is not paused; wait for a breakpoint");List<Object> frames=new ArrayList<>();for(StackFrame f:t.frames(0,Math.min(8,t.frameCount()))){Location l=f.location();Map<String,Object> locals=new LinkedHashMap<>();try{for(LocalVariable variable:f.visibleVariables()){if(locals.size()==30)break;locals.put(variable.name(),value(f.getValue(variable)));}}catch(AbsentInformationException missing){locals.put("gap","Local variable debug metadata unavailable");}frames.add(record("class",l.declaringType().name(),"method",l.method().name(),"line",l.lineNumber(),"locals",locals));}return record("thread",t.uniqueID(),"frames",frames);}
    if(action.equals("resume")){if(p.containsKey("thread")){long id=Long.parseLong(p.get("thread"));EventSet set=paused.remove(id);pausedAt.remove(id);if(set!=null)set.resume();}else{for(EventSet set:new HashSet<>(paused.values()))set.resume();paused.clear();pausedAt.clear();}return record("resumed",true);}
    if(action.equals("detach")){command(Map.of("action","resume"));vm.dispose();return record("detached",true);}
    throw new IllegalArgumentException("Unknown debug action");
  }
  static void pump(){while(true)try{EventSet set=vm.eventQueue().remove(200);synchronized(ServiceDebugger.class){if(set!=null){boolean hold=false;for(Event ev:set){if(ev instanceof ClassPrepareEvent c){String id=(String)c.request().getProperty("id");Map<String,String> p=points.get(id);if(p!=null)try{install(id,p,c.referenceType());}catch(Exception e){event("unresolved",record("breakpoint",id,"reason",e.toString()));}}
      if(ev instanceof BreakpointEvent b){long id=b.thread().uniqueID();event("breakpoint-hit",record("breakpoint",b.request().getProperty("id"),"thread",id,"class",b.location().declaringType().name(),"method",b.location().method().name(),"line",b.location().lineNumber()));paused.put(id,set);pausedAt.put(id,System.currentTimeMillis());hold=true;}}
      if(!hold)set.resume();}for(long id:new ArrayList<>(paused.keySet()))if(System.currentTimeMillis()-pausedAt.get(id)>60000){paused.remove(id).resume();pausedAt.remove(id);event("auto-resumed",record("thread",id,"reason","Pause limit"));}}}catch(VMDisconnectedException e){return;}catch(Exception e){synchronized(ServiceDebugger.class){event("debug-error",record("error",e.toString()));}}}
  public static void main(String[] args)throws Exception{
    AttachingConnector connector=Bootstrap.virtualMachineManager().attachingConnectors().stream().filter(c->c.name().equals("com.sun.jdi.SocketAttach")).findFirst().orElseThrow();Map<String,Connector.Argument> arguments=connector.defaultArguments();arguments.get("hostname").setValue(args[0]);arguments.get("port").setValue(args[1]);arguments.get("timeout").setValue("5000");vm=connector.attach(arguments);
    HttpServer server=HttpServer.create(new InetSocketAddress("0.0.0.0",Integer.parseInt(args[2])),0);server.createContext("/",exchange->{try{String expected=System.getenv("DT_DEBUG_TOKEN");if(expected==null||!expected.equals(exchange.getRequestHeaders().getFirst("x-dt-debug-token"))){exchange.sendResponseHeaders(403,-1);exchange.close();return;}Map<String,String> params=new HashMap<>();for(String item:Optional.ofNullable(exchange.getRequestURI().getRawQuery()).orElse("").split("&")){String[] pair=item.split("=",2);if(pair.length==2)params.put(URLDecoder.decode(pair[0],StandardCharsets.UTF_8),URLDecoder.decode(pair[1],StandardCharsets.UTF_8));}Object result;int status=200;try{result=command(params);}catch(Exception error){status=400;result=record("error",error.toString());}byte[] bytes=json(result).getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("content-type","application/json; charset=utf-8");exchange.sendResponseHeaders(status,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();}catch(Exception e){exchange.close();}});server.setExecutor(Executors.newSingleThreadExecutor());server.start();new Thread(ServiceDebugger::pump,"dt-jdi-events").start();
  }
}

package com.lumen.orders;
import java.util.Map;
import java.util.LinkedHashMap;
public final class OrderProjectionService {
  public interface Functions {
    Map<String,String> projection(String tenant,String orderId);
    String accountLabel(String tenant,String accountId);
    String releaseLabel(String tenant,String orderId);
  }
  private final Functions functions;
  public OrderProjectionService(Functions functions){this.functions=functions;}
  public Map<String,String> load(String tenant,String orderId){
    Map<String,String> row=functions.projection(tenant,orderId);
    if(row==null)return null;
    Map<String,String> result=new LinkedHashMap<>(row);
    result.put("accountLabel",functions.accountLabel(tenant,row.get("account_id")));
    result.put("releaseLabel",functions.releaseLabel(tenant,orderId));
    return result;
  }
  public static final String FIND="select amount from sales.orders where tenant_id=? and id=?";
  public static final String UPDATE="update sales.orders set amount=? where tenant_id=? and id=?";
}

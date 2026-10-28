package com.lumen.orders;
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

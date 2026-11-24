package fixture;
import java.sql.ResultSet;
public class PersonMapper {
  public Person map(ResultSet rs) throws Exception {
    Person result = new Person();
    result.setLegalName(rs.getString("legal_name"));
    return result;
  }
}

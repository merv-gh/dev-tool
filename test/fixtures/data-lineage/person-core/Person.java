package fixture;
import javax.persistence.*;
import lombok.Getter;
import lombok.Setter;
@Entity
@Table(name = "person", schema = "public")
@Getter @Setter
public class Person {
  @Id private Long id;
  @Column(name = "legal_name") private String legalName;
}

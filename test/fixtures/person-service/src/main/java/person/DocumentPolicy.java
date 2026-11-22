package person;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import person.PersonData.Document;

public final class DocumentPolicy {
    private DocumentPolicy() {}
    public static boolean eligible(Document d, LocalDate asOf) {
        return d.active()
            && !d.annulled()
            && !d.effectiveFrom().isAfter(asOf)
            && (d.expiresOn() == null || !d.expiresOn().isBefore(asOf))
            && d.name().complete();
    }
    public static Document choose(List<Document> documents, LocalDate asOf) {
        return documents.stream()
            .filter(d -> eligible(d, asOf))
            .max(Comparator.comparing(Document::effectiveFrom).thenComparingLong(Document::id))
            .orElse(null);
    }
}

package com.lumen.ledger;
import java.math.BigDecimal;
import com.lumen.money.LedgerAmount;
public final class PostingService {
  public static long post(String amount, String currency) { return LedgerAmount.minorUnits(new BigDecimal(amount), currency); }
  public static void main(String[] args) { System.out.println(post(args[0],args[1])); }
}

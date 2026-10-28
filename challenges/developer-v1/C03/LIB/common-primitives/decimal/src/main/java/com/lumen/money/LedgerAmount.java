package com.lumen.money;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Map;
public final class LedgerAmount {
  private static final Map<String,Integer> SCALE = Map.of("USD",2,"EUR",2,"JPY",0,"KWD",3);
  public static long minorUnits(BigDecimal amount, String currency) {
    if (amount == null || amount.signum()<0 || !SCALE.containsKey(currency)) throw new IllegalArgumentException("invalid amount or currency");
    return amount.movePointRight(2).setScale(0,RoundingMode.HALF_UP).longValueExact();
  }
}

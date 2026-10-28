package com.acme.pay;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// The showcase's test of FeeCalculator#fee: 2.9% + 0.30, at least 0.50, in cents rounded half up.
// 12.70 finds the bug in the demo service (it rounds down); the other cases pass.
class FeeCalculatorTest {
    FeeCalculator fees = new FeeCalculator();

    @ParameterizedTest
    @CsvSource({ "12.70, 0.67", "1.00, 0.50", "100.00, 3.20" })
    void feeIsRoundedHalfUp(String amount, String fee) {
        assertThat(fees.fee(new BigDecimal(amount))).isEqualByComparingTo(fee);
    }

    @Test
    void rejectsZero() {
        assertThatThrownBy(() -> fees.fee(BigDecimal.ZERO)).isInstanceOf(IllegalArgumentException.class);
    }
}

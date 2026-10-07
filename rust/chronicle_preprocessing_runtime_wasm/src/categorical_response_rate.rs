//! Response rate for an exact two-token categorical vocabulary.
//!
//! Empty input is distinct from a missing label column on non-empty input.
//! Missing values and labels outside the exact vocabulary do not contribute to
//! either the numerator or denominator.

const RESPONDED_LABEL: &str = "responded";
const NO_RESPONSE_LABEL: &str = "no-response";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CategoricalResponseRateInput<'a> {
    Present(&'a [Option<&'a str>]),
    MissingColumn { row_count: usize },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CategoricalResponseRateError {
    MissingLabelColumn,
}

pub(crate) fn categorical_response_rate(
    input: CategoricalResponseRateInput<'_>,
) -> Result<f64, CategoricalResponseRateError> {
    let labels = match input {
        CategoricalResponseRateInput::Present(labels) => labels,
        CategoricalResponseRateInput::MissingColumn { row_count: 0 } => return Ok(f64::NAN),
        CategoricalResponseRateInput::MissingColumn { .. } => {
            return Err(CategoricalResponseRateError::MissingLabelColumn)
        }
    };

    if labels.is_empty() {
        return Ok(f64::NAN);
    }

    let responded = labels
        .iter()
        .filter(|label| **label == Some(RESPONDED_LABEL))
        .count();
    let no_response = labels
        .iter()
        .filter(|label| **label == Some(NO_RESPONSE_LABEL))
        .count();
    let denominator = responded + no_response;

    if denominator == 0 {
        Ok(f64::NAN)
    } else {
        Ok(responded as f64 / denominator as f64)
    }
}

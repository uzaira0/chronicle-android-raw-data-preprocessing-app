//! Exact count-ratio construction from caller-supplied counts.
//!
//! The numerator and summed denominator remain available as integers. The
//! caller owns event classification, grouping, and missing-row behavior.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CountRatioError {
    MissingDenominatorTerms,
    DenominatorOverflow,
    ZeroDenominator,
}

impl fmt::Display for CountRatioError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingDenominatorTerms => {
                formatter.write_str("count ratio requires at least one denominator term")
            }
            Self::DenominatorOverflow => formatter.write_str("count ratio denominator overflowed"),
            Self::ZeroDenominator => formatter.write_str("count ratio denominator is zero"),
        }
    }
}

impl std::error::Error for CountRatioError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CountRatio {
    pub numerator: u64,
    pub denominator: u64,
}

impl CountRatio {
    pub fn value(self) -> f64 {
        self.numerator as f64 / self.denominator as f64
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CountRatioRequest<Name> {
    pub name: Name,
    pub numerator: u64,
    pub denominator_terms: Vec<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamedCountRatio<Name> {
    pub name: Name,
    pub ratio: CountRatio,
}

/// Construct every named ratio in one configuration, preserving request order.
pub fn construct_named_count_ratios<Name, Requests>(
    requests: Requests,
) -> Result<Vec<NamedCountRatio<Name>>, CountRatioError>
where
    Requests: IntoIterator<Item = CountRatioRequest<Name>>,
{
    requests
        .into_iter()
        .map(|request| {
            ratio_of_count_to_sum(request.numerator, &request.denominator_terms).map(|ratio| {
                NamedCountRatio {
                    name: request.name,
                    ratio,
                }
            })
        })
        .collect()
}

fn ratio_of_count_to_sum(
    numerator: u64,
    denominator_terms: &[u64],
) -> Result<CountRatio, CountRatioError> {
    if denominator_terms.is_empty() {
        return Err(CountRatioError::MissingDenominatorTerms);
    }
    let denominator = checked_count_sum(denominator_terms)?;
    if denominator == 0 {
        return Err(CountRatioError::ZeroDenominator);
    }
    Ok(CountRatio {
        numerator,
        denominator,
    })
}

/// Existing checked denominator-term sum, also usable for a supplied complete
/// integer increment inventory. An explicitly empty sum is zero, not missing.
pub fn checked_count_sum(terms: &[u64]) -> Result<u64, CountRatioError> {
    terms
        .iter()
        .try_fold(0_u64, |sum, term| sum.checked_add(*term))
        .ok_or(CountRatioError::DenominatorOverflow)
}

//! Three-way classification of finite scalars around a caller-supplied pivot.
//!
//! The caller owns the scalar's meaning and the three output categories. This
//! operator preserves the equality case rather than approximating it with a
//! second threshold or a tolerance.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FiniteScalarPivotClassifierError {
    NonFinitePivot,
    NonFiniteObservation,
}

impl fmt::Display for FiniteScalarPivotClassifierError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonFinitePivot => formatter.write_str("scalar pivot must be finite"),
            Self::NonFiniteObservation => formatter.write_str("scalar observation must be finite"),
        }
    }
}

impl std::error::Error for FiniteScalarPivotClassifierError {}

#[derive(Debug, Clone, PartialEq)]
pub struct FiniteScalarPivotClassifier<Category> {
    pivot: f64,
    below: Category,
    equal: Category,
    above: Category,
}

impl<Category> FiniteScalarPivotClassifier<Category> {
    pub fn new(
        pivot: f64,
        below: Category,
        equal: Category,
        above: Category,
    ) -> Result<Self, FiniteScalarPivotClassifierError> {
        if !pivot.is_finite() {
            return Err(FiniteScalarPivotClassifierError::NonFinitePivot);
        }
        Ok(Self {
            pivot,
            below,
            equal,
            above,
        })
    }

    pub fn category_for(
        &self,
        observation: f64,
    ) -> Result<&Category, FiniteScalarPivotClassifierError> {
        if !observation.is_finite() {
            return Err(FiniteScalarPivotClassifierError::NonFiniteObservation);
        }
        if observation < self.pivot {
            Ok(&self.below)
        } else if observation > self.pivot {
            Ok(&self.above)
        } else {
            Ok(&self.equal)
        }
    }

    #[cfg(test)]
    #[allow(
        dead_code,
        reason = "source integration tests include this module but only some inspect configuration"
    )]
    pub fn pivot(&self) -> f64 {
        self.pivot
    }

    #[cfg(test)]
    #[allow(
        dead_code,
        reason = "source integration tests include this module but only some inspect configuration"
    )]
    pub fn categories(&self) -> (&Category, &Category, &Category) {
        (&self.below, &self.equal, &self.above)
    }
}

//! Medoid selection from a caller-supplied square distance matrix.
//!
//! Columns are summed, and the first column attaining the minimum sum is
//! selected. A two-point matrix selects its first point directly. Matrix
//! construction, distance calculation, and upstream point ordering are outside
//! this primitive.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DistanceMatrixMedoidError {
    EmptyMatrix,
    NonSquareMatrix {
        row_index: usize,
        expected: usize,
        actual: usize,
    },
    NonFiniteDistance {
        row_index: usize,
        column_index: usize,
    },
}

pub(crate) fn distance_matrix_medoid_index(
    matrix: &[Vec<f64>],
) -> Result<usize, DistanceMatrixMedoidError> {
    let point_count = matrix.len();
    if point_count == 0 {
        return Err(DistanceMatrixMedoidError::EmptyMatrix);
    }
    for (row_index, row) in matrix.iter().enumerate() {
        if row.len() != point_count {
            return Err(DistanceMatrixMedoidError::NonSquareMatrix {
                row_index,
                expected: point_count,
                actual: row.len(),
            });
        }
        if let Some(column_index) = row.iter().position(|distance| !distance.is_finite()) {
            return Err(DistanceMatrixMedoidError::NonFiniteDistance {
                row_index,
                column_index,
            });
        }
    }

    if point_count == 2 {
        return Ok(0);
    }

    let mut column_sums = vec![0.0; point_count];
    for row in matrix {
        for (column_sum, distance) in column_sums.iter_mut().zip(row) {
            *column_sum += distance;
        }
    }

    let mut minimum_index = 0;
    for candidate_index in 1..point_count {
        if column_sums[candidate_index] < column_sums[minimum_index] {
            minimum_index = candidate_index;
        }
    }
    Ok(minimum_index)
}

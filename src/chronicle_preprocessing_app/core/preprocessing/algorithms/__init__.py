"""
App usage processing algorithms and optimizers.
"""

from __future__ import annotations

from .app_usage_algorithms import (
    BaselineAlgorithm,
    safe_duration_seconds,
    safe_timestamp_compare,
)
from .app_usage_details_optimizer import (
    OptimizedAppUsageDetailsProcessor,
    create_optimized_processor,
)

__all__ = [
    # Algorithm implementation
    "BaselineAlgorithm",
    # Utility functions
    "safe_timestamp_compare",
    "safe_duration_seconds",
    # Optimizer
    "OptimizedAppUsageDetailsProcessor",
    "create_optimized_processor",
]

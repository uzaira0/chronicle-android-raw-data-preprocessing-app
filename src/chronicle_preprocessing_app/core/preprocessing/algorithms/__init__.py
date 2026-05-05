"""
App usage processing algorithms and optimizers.
"""

from __future__ import annotations

from .app_usage_algorithms import (
    OptimizedAppUsageAlgorithm,
    safe_duration_seconds,
    safe_timestamp_compare,
)
from .app_usage_details_optimizer import (
    OptimizedAppUsageDetailsProcessor,
    create_optimized_processor,
)

__all__ = [
    # Algorithm implementation
    "OptimizedAppUsageAlgorithm",
    # Optimizer
    "OptimizedAppUsageDetailsProcessor",
    "create_optimized_processor",
    "safe_duration_seconds",
    # Utility functions
    "safe_timestamp_compare",
]

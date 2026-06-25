/**
 * Range check for numeric settings inputs. Returns a short message when the
 * value is outside [min, max] (or not a number), otherwise null. Used to surface
 * a visible error state instead of silently keeping an out-of-range value.
 */
export function rangeError(value: number, min?: number, max?: number): string | null {
  if (Number.isNaN(value)) return "Enter a number";
  if (min !== undefined && value < min) {
    return max !== undefined ? `Enter a value between ${min} and ${max}` : `Must be at least ${min}`;
  }
  if (max !== undefined && value > max) {
    return min !== undefined ? `Enter a value between ${min} and ${max}` : `Must be at most ${max}`;
  }
  return null;
}

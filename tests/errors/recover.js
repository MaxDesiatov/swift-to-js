export function attempt$shouldThrow$(shouldThrow) {
  if (shouldThrow) {
    throw 0;
  }
}
export function recover$shouldThrow$(shouldThrow) {
  try {
    attempt$shouldThrow$(shouldThrow);
    return 1;
  } catch (error) {
    return 0;
  }
}
let invariantCounter = 1;

export function resetInvariantCounter(v = 1) {
  invariantCounter = v;
}

export function nextInvariantId(): string {
  return `inv-${invariantCounter++}`;
}

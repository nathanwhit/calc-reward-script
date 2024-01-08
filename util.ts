export const CTC = 1_000_000_000_000_000_000n;

export function toCtcApprox(credo: bigint) {
  const o = credo / CTC;
  const rem = credo % CTC;
  const remApprox = Number(rem) / Number(CTC);
  return Number(o) + remApprox;
}

export function assertExhaustive(n: never): never {
  throw new Error(`Unreachable: ${n}`);
}

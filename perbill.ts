import { assertExhaustive } from "./util.js";

// all of this ported from rust implementation

enum Rounding {
  Up,
  Down,
}

function divRounded(
  numerator: bigint,
  denominator: bigint,
  rounding: Rounding
) {
  let o = numerator / denominator;
  switch (rounding) {
    case Rounding.Up:
      if (numerator % denominator !== 0n) {
        o++;
      }
      break;
    case Rounding.Down:
      break;
    default:
      assertExhaustive(rounding);
  }
  return o;
}

function max(a: bigint, b: bigint) {
  return a > b ? a : b;
}

export class PerBill {
  static ACCURACY = 1_000_000_000n;
  constructor(private value: bigint) {}
  static fromParts(value: bigint): PerBill {
    return new PerBill(value);
  }
  static fromRational(numerator: bigint, denominator: bigint): PerBill {
    if (denominator === 0n) {
      throw new Error("Division by zero");
    }
    if (numerator > denominator) {
      throw new Error("Numerator greater than denominator");
    }
    if (numerator < 0n || denominator < 0n) {
      throw new Error("Negative value");
    }
    const factor = max(
      divRounded(denominator, PerBill.ACCURACY, Rounding.Up),
      1n
    );
    const dReduce = divRounded(denominator, factor, Rounding.Down);
    const nReduce = divRounded(numerator, factor, Rounding.Down);
    const n = nReduce * PerBill.ACCURACY;
    const d = dReduce;
    const part = divRounded(n, d, Rounding.Down);
    return new PerBill(part);
  }
  mul(other: PerBill): PerBill {
    const a = this.value;
    const b = other.value;
    const m = PerBill.ACCURACY;
    const parts = (a * b) / m;
    return PerBill.fromParts(parts);
  }
  muln(other: bigint): bigint {
    const num = this.value * other;
    return divRounded(num, PerBill.ACCURACY, Rounding.Down);
  }
}

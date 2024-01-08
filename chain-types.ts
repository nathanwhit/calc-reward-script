import {
  Struct,
  u32,
  BTreeMap,
  Compact,
  u128,
  Vec,
  bool,
} from "@polkadot/types";
import { AccountId32, Perbill } from "@polkadot/types/interfaces";

export interface PalletStakingEraRewardPoints extends Struct {
  readonly total: u32;
  readonly individual: BTreeMap<AccountId32, u32>;
}

export interface PalletStakingIndividualExposure extends Struct {
  readonly who: AccountId32;
  readonly value: Compact<u128>;
}

export interface PalletStakingExposure extends Struct {
  readonly total: Compact<u128>;
  readonly own: Compact<u128>;
  readonly others: Vec<PalletStakingIndividualExposure>;
}

export interface PalletStakingUnlockChunk extends Struct {
  readonly value: Compact<u128>;
  readonly era: Compact<u32>;
}

export interface PalletStakingStakingLedger extends Struct {
  readonly stash: AccountId32;
  readonly total: Compact<u128>;
  readonly active: Compact<u128>;
  readonly unlocking: Vec<PalletStakingUnlockChunk>;
  readonly claimedRewards: Vec<u32>;
}

export interface PalletStakingValidatorPrefs extends Struct {
  readonly commission: Compact<Perbill>;
  readonly blocked: bool;
}

export interface PalletStakingNominations extends Struct {
  readonly targets: Vec<AccountId32>;
  readonly submittedIn: u32;
  readonly suppressed: bool;
}

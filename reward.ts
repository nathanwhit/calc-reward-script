import { ApiPromise } from "@polkadot/api";
import {
  PalletStakingEraRewardPoints,
  PalletStakingExposure,
  PalletStakingNominations,
  PalletStakingStakingLedger,
  PalletStakingValidatorPrefs,
} from "./chain-types.js";
import { AccountId32 } from "@polkadot/types/interfaces";
import { Option, u128 } from "@polkadot/types";
import { toCtcApprox, assertExhaustive } from "./util.js";
import { PerBill } from "./perbill.js";

/// The calculated reward information for a validator in a specific era.
type ValidatorReward<Repr> = {
  totalReward: Repr;
  rewardForValidator: {
    commission: Repr;
    staking: Repr;
    total: Repr;
  };
  nominatorRewards: Map<string, Repr>;
  accountId: string;
};

/// Convenience - calculated reward information for a validator in a specific era, with
/// function to convert from credo values to CTC values.
type ValidatorRewardInfo = ValidatorReward<bigint> & {
  toCtc(): ValidatorReward<number>;
};

type NominatorReward<Repr> = {
  rewardForValidators: Map<string, Repr>;
  totalReward: Repr;
  accountId: string;
};

type NominatorRewardInfo = NominatorReward<bigint> & {
  toCtc(): NominatorReward<number>;
};

function validatorToCtc(
  info: ValidatorReward<bigint>
): ValidatorReward<number> {
  return {
    rewardForValidator: {
      commission: toCtcApprox(info.rewardForValidator.commission),
      staking: toCtcApprox(info.rewardForValidator.staking),
      total: toCtcApprox(info.rewardForValidator.total),
    },
    nominatorRewards: new Map(
      Array.from(info.nominatorRewards.entries()).map(([k, v]) => [
        k,
        toCtcApprox(v),
      ])
    ),
    accountId: info.accountId,
    totalReward: toCtcApprox(info.totalReward),
  };
}

function nominatorToCtc(
  info: NominatorReward<bigint>
): NominatorReward<number> {
  return {
    rewardForValidators: new Map(
      Array.from(info.rewardForValidators.entries()).map(([k, v]) => [
        k,
        toCtcApprox(v),
      ])
    ),
    totalReward: toCtcApprox(info.totalReward),
    accountId: info.accountId,
  };
}

function zeroReward(accountId: string): ValidatorRewardInfo {
  return {
    totalReward: 0n,
    rewardForValidator: {
      commission: 0n,
      staking: 0n,
      total: 0n,
    },
    nominatorRewards: new Map(),
    accountId,
    toCtc() {
      return {
        totalReward: 0,
        rewardForValidator: {
          commission: 0,
          staking: 0,
          total: 0,
        },
        nominatorRewards: new Map(),
        accountId,
      };
    },
  };
}

/**
 * The exposure of a validator in a specific era.
 */
type Exposure = {
  /**
   *  The amount staked by the validator themself.
   */
  own: bigint;
  /**
   * The total amount staked for the validator.
   */
  total: bigint;
  /**
   * The amounts staked by nominators.
   */
  others: Map<string, bigint>;
};

/**
 * Information about a validator in a specific era that is necessary for calculating the reward info.
 */
type ValidatorEraStakingInfo = {
  /**
   * The total payout for the era, across all validators.
   */
  eraPayout: bigint;
  /**
   * The reward points for the era.
   */
  eraRewardPoints: {
    /**
     * The total reward points for the era, across all validators.
     */
    total: bigint;
    /**
     * The reward points for this individual validator.
     */
    individual: bigint;
  };
  /**
   * The exposure of the validator in the era.
   */
  exposure: Exposure;
  /**
   * Validators commission for the era.
   */
  validatorCommission: PerBill;
};

/** Fetches the data necessary for calculating the reward info for a validator in a specific era, then processes it a bit
 * to make it easier to work with.
 */
async function getEraStakingInfo(
  api: ApiPromise,
  account: string,
  era: number
): Promise<ValidatorEraStakingInfo | undefined> {
  const stakingApi = api.query.staking;
  const controllerOpt = await stakingApi.bonded<Option<AccountId32>>(account);
  if (controllerOpt.isNone) {
    return undefined;
  }
  const controller = controllerOpt.unwrap();
  const [eraPayoutOpt, ledgerOpt, eraRewardPoints, exposure, validatorPrefs] =
    await api.queryMulti<
      [
        Option<u128>,
        Option<PalletStakingStakingLedger>,
        PalletStakingEraRewardPoints,
        PalletStakingExposure,
        PalletStakingValidatorPrefs
      ]
    >([
      [stakingApi.erasValidatorReward, era], // the total payout for the era
      [stakingApi.ledger, controller], // the staking ledger for the controller
      [stakingApi.erasRewardPoints, era], // the reward points for the era
      [stakingApi.erasStakersClipped, [era, account]], // the exposure for the validator
      [stakingApi.erasValidatorPrefs, [era, account]], // the validator prefs for the validator in the era
    ]);

  if (eraPayoutOpt.isNone) {
    return undefined;
  }
  const eraPayout = eraPayoutOpt.unwrap();

  if (ledgerOpt.isNone) {
    return undefined;
  }

  const ledger = ledgerOpt.unwrap();

  const stash = ledger.stash;
  const totalRewardPoints = eraRewardPoints.total;
  const entries = Array.from(eraRewardPoints.individual.entries());
  const individuals = new Map(
    entries.map(([k, v]) => [k.toString(), v.toBigInt()])
  );
  const validatorRewardPoints = individuals.get(stash.toString()) ?? 0n;

  const validatorCommission = PerBill.fromParts(
    // the commission value is just the numerator of a Perbill, so we use `fromParts`
    validatorPrefs.commission.unwrap().toBigInt()
  );

  return {
    eraPayout: eraPayout.toBigInt(),
    eraRewardPoints: {
      individual: validatorRewardPoints,
      total: totalRewardPoints.toBigInt(),
    },
    exposure: {
      own: exposure.own.unwrap().toBigInt(),
      total: exposure.total.unwrap().toBigInt(),
      others: new Map(
        exposure.others.map((exp) => [exp.who.toString(), exp.value.toBigInt()])
      ),
    },
    validatorCommission,
  };
}

/**
 * calculate the reward info for a validator in a specific era.
 */
function calculateStakingReward(
  values: ValidatorEraStakingInfo,
  accountId: string
): ValidatorRewardInfo {
  const { eraPayout, eraRewardPoints, exposure, validatorCommission } = values;

  const totalRewardPoints = eraRewardPoints.total;
  const validatorRewardPoints = eraRewardPoints.individual;

  if (validatorRewardPoints === 0n) {
    return zeroReward(accountId);
  }

  // the proportion of the total reward points that this validator has
  const validatorTotalRewardPart = PerBill.fromRational(
    validatorRewardPoints,
    totalRewardPoints
  );

  // the total reward for the validator (their fraction of the total reward points times the total payout)
  const validatorTotalPayout = validatorTotalRewardPart.muln(eraPayout);

  // the amount of the total reward that goes to the validator's commission
  const validatorCommissionPayout =
    validatorCommission.muln(validatorTotalPayout);

  // the reward amount left over after the commission is paid
  const validatorLeftoverPayout =
    validatorTotalPayout - validatorCommissionPayout;

  // amountStakedByValidator / amountStakedByValidatorAndNominators
  const validatorExposurePart = PerBill.fromRational(
    exposure.own,
    exposure.total
  );

  // the validator's share of the reward, based on their exposure
  const validatorStakingPayout = validatorExposurePart.muln(
    validatorLeftoverPayout
  );

  // the total reward for the validator
  const validatorReward = validatorCommissionPayout + validatorStakingPayout;

  const nominatorRewards = new Map<string, bigint>();

  for (const [nominator, stake] of exposure.others) {
    // the nominator's share of the exposure
    const nominatorExposurePart = PerBill.fromRational(stake, exposure.total);
    // the nominator's share of reward, based on their exposure
    const nominatorReward = nominatorExposurePart.muln(validatorLeftoverPayout);
    nominatorRewards.set(nominator, nominatorReward);
  }

  const validatorRewardInfo = {
    rewardForValidator: {
      total: validatorReward,
      commission: validatorCommissionPayout,
      staking: validatorStakingPayout,
    },
    totalReward: validatorTotalPayout,
    nominatorRewards,
    accountId,
  };

  return {
    ...validatorRewardInfo,
    toCtc() {
      return validatorToCtc(validatorRewardInfo);
    },
  };
}

/**
 * Calculate the reward info for a validator in a specific era.
 */
async function calculateValidatorRewardInfo(
  api: ApiPromise,
  account: string,
  era: number
): Promise<ValidatorRewardInfo | undefined> {
  const info = await getEraStakingInfo(api, account, era);
  if (info === undefined) {
    return undefined;
  }
  return calculateStakingReward(info, account);
}

/**
 * Get the validators that a nominator has nominated.
 *
 * NOTE: this isn't actually quite accurate, as it's the current nominations. if the nominator has nominated or removed
 * nominators in the era we're calculating the reward for, this won't be accurate. however, it's close enough for now.
 */
async function getValidatorsForNominator(api: ApiPromise, account: string) {
  const nominations = await api.query.staking.nominators<
    Option<PalletStakingNominations>
  >(account);

  const targets = nominations.unwrapOrDefault().targets;

  return targets.map((c) => c.toString());
}

/**
 * Calculate the reward info for a nominator in a specific era.
 */
async function calculateNominatorRewardInfo(
  api: ApiPromise,
  account: string,
  era: number
): Promise<NominatorRewardInfo | undefined> {
  // get the validators that the nominator has nominated (ish)
  const validators = await getValidatorsForNominator(api, account);

  // calculate the reward info for each validator
  const validatorRewards = await Promise.all(
    validators.map((v) => calculateValidatorRewardInfo(api, v, era))
  );

  // sum up the rewards for this nominator across all validators
  const nominatorReward = validatorRewards.reduce((acc, cur) => {
    if (cur === undefined) {
      return acc;
    }
    const nominatorReward = cur.nominatorRewards.get(account);

    return acc + (nominatorReward ?? 0n);
  }, 0n);

  const nominatorRewardInfo = {
    // the reward for each validator, keyed by validator account id
    rewardForValidators: new Map(
      validatorRewards
        .filter((v) => v !== undefined)
        .map((v) => [v!.accountId, v!.nominatorRewards.get(account) ?? 0n])
    ),
    totalReward: nominatorReward,
    accountId: account,
  };
  return {
    ...nominatorRewardInfo,
    toCtc() {
      return nominatorToCtc(nominatorRewardInfo);
    },
  };
}

export async function stakingReward(
  api: ApiPromise,
  account: string,
  era: number,
  role: "validator" | "nominator" = "validator"
): Promise<ValidatorRewardInfo | NominatorRewardInfo | undefined> {
  switch (role) {
    case "validator": {
      const validatorReward = await calculateValidatorRewardInfo(
        api,
        account,
        era
      );
      return validatorReward;
    }
    case "nominator": {
      const nominatorReward = await calculateNominatorRewardInfo(
        api,
        account,
        era
      );
      return nominatorReward;
    }
    default:
      assertExhaustive(role);
  }
}

import { ApiPromise, WsProvider } from "@polkadot/api";
import { stakingReward } from "./reward.js";

async function withApi<T>(
  endpoint: string,
  f: (api: ApiPromise) => Promise<T>
): Promise<T> {
  const api = await ApiPromise.create({
    provider: new WsProvider(endpoint),
    noInitWarn: true,
  });

  try {
    const result = await f(api);
    return result;
  } finally {
    api.disconnect();
  }
}

async function main(api: ApiPromise) {
  const reward = await stakingReward(
    api,
    "5EYCAe5g8RCk5pv3ANvit92JTtaZftyw8QFMyCk6aurapUcC",
    53,
    "nominator"
  );
  console.log(reward?.toCtc());
}

await withApi("wss://rpc.cc3-devnet.creditcoin.network", main);

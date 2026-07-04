import type { Address } from "viem";
import { veilAdsAbi } from "./abi";

const zeroAddress = "0x0000000000000000000000000000000000000000";

export const veilAdsAddress = (process.env.NEXT_PUBLIC_VEILADS_ADDRESS || zeroAddress) as Address;
export const isContractConfigured = veilAdsAddress.toLowerCase() !== zeroAddress;
export const veilAdsDeployBlock = BigInt(process.env.NEXT_PUBLIC_VEILADS_DEPLOY_BLOCK || "0");

export const veilAdsContract = {
  address: veilAdsAddress,
  abi: veilAdsAbi,
} as const;

export const categories = ["Tech", "Gaming", "Fitness", "Travel", "Finance"] as const;

export type CampaignInfo = {
  id: bigint;
  advertiser: Address;
  escrow: bigint;
  active: boolean;
  adURI: string;
  createTxHash?: `0x${string}`;
};

"use client";

import { Encryptable } from "@cofhe/sdk";
import { sepolia } from "@cofhe/sdk/chains";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/web";
import type { PublicClient, WalletClient } from "viem";

export type EncryptedInput = {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: `0x${string}`;
};

export type EncryptedInputTuple5 = [
  EncryptedInput,
  EncryptedInput,
  EncryptedInput,
  EncryptedInput,
  EncryptedInput
];

let client: ReturnType<typeof createCofheClient> | null = null;

function getClient() {
  if (!client) {
    client = createCofheClient(
      createCofheConfig({
        supportedChains: [sepolia],
        useWorkers: false,
      })
    );
  }
  return client;
}

export async function connectCofhe(publicClient: PublicClient, walletClient: WalletClient) {
  const cofhe = getClient();
  if (!cofhe.connected) {
    await cofhe.connect(publicClient as never, walletClient as never);
  }
  return cofhe;
}

export async function encryptUint8Set(
  publicClient: PublicClient,
  walletClient: WalletClient,
  values: number[]
) {
  if (values.length !== 5) {
    throw new Error("VeilAds requires exactly five encrypted category values.");
  }
  const cofhe = await connectCofhe(publicClient, walletClient);
  const encrypted = await cofhe.encryptInputs(values.map((value) => Encryptable.uint8(BigInt(value)))).execute();
  return encrypted as EncryptedInputTuple5;
}

export async function encryptBid(
  publicClient: PublicClient,
  walletClient: WalletClient,
  weiValue: bigint
) {
  const cofhe = await connectCofhe(publicClient, walletClient);
  const [bid] = await cofhe.encryptInputs([Encryptable.uint64(weiValue)]).execute();
  return bid as EncryptedInput;
}

export async function encryptViewTime(
  publicClient: PublicClient,
  walletClient: WalletClient,
  seconds: number
) {
  const cofhe = await connectCofhe(publicClient, walletClient);
  const [viewTime] = await cofhe.encryptInputs([Encryptable.uint32(BigInt(seconds))]).execute();
  return viewTime as EncryptedInput;
}

export async function decryptForTx(
  publicClient: PublicClient,
  walletClient: WalletClient,
  handle: bigint
) {
  const cofhe = await connectCofhe(publicClient, walletClient);
  return cofhe.decryptForTx(handle).withoutPermit().execute();
}

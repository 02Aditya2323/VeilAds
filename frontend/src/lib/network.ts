import { http } from "viem";
import { sepolia } from "viem/chains";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

export const ethereumSepolia = sepolia;
export const REQUIRED_CHAIN_ID = ethereumSepolia.id;

export const wagmiConfig = createConfig({
  chains: [ethereumSepolia],
  connectors: [
    injected(),
  ],
  transports: {
    [ethereumSepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL),
  },
  ssr: true,
});

export function shortAddress(address?: string) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

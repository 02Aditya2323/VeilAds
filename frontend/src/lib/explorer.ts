export function txUrl(hash?: `0x${string}`) {
  return hash ? `https://sepolia.etherscan.io/tx/${hash}` : undefined;
}

export function addressUrl(address?: string) {
  return address ? `https://sepolia.etherscan.io/address/${address}` : undefined;
}

export function normalizeAdLink(uri: string) {
  if (uri.startsWith("ipfs://")) {
    const cid = uri.replace("ipfs://", "");
    const gateway = process.env.NEXT_PUBLIC_PINATA_GATEWAY || "https://gateway.pinata.cloud/ipfs/";
    return `${gateway.replace(/\/?$/, "/")}${cid}`;
  }
  return uri;
}

export function getMediaKind(url: string): "image" | "video" | "unknown" {
  const cleanUrl = url.split("?")[0].toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp|avif|svg)$/.test(cleanUrl)) return "image";
  if (/\.(mp4|webm|ogg|mov|m4v)$/.test(cleanUrl)) return "video";
  return "unknown";
}

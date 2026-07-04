import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const token = process.env.PINATA_JWT;
  if (!token) {
    return NextResponse.json({ error: "PINATA_JWT is not configured." }, { status: 500 });
  }

  const incoming = await request.formData();
  const file = incoming.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field." }, { status: 400 });
  }

  const formData = new FormData();
  formData.set("file", file, file.name);
  formData.set(
    "pinataMetadata",
    JSON.stringify({
      name: `veilads-${Date.now()}-${file.name}`,
    })
  );

  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    return NextResponse.json({ error: "Pinata upload failed.", detail }, { status: response.status });
  }

  const payload = (await response.json()) as { IpfsHash: string };
  const gateway = process.env.NEXT_PUBLIC_PINATA_GATEWAY || "https://gateway.pinata.cloud/ipfs/";
  return NextResponse.json({
    cid: payload.IpfsHash,
    uri: `ipfs://${payload.IpfsHash}`,
    gatewayUrl: `${gateway.replace(/\/?$/, "/")}${payload.IpfsHash}`,
  });
}

import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import type { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  context:
    | { params: { address: string } }
    | { params: Promise<{ address: string }> },
) {
  const paramsResolved =
    (context as any).params &&
    typeof (context as any).params.then === "function"
      ? await (context as any).params
      : (context as any).params;
  const addressHash = paramsResolved.address;
  if (!addressHash)
    return NextResponse.json({ error: "Address required" }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") || "10", 10), 1000);

  const client = await clientPromise;
  const db = client.db();

  // Find address document (addresses collection)
  const addressData = await db.collection("addresses").findOne({
    $or: [{ a_id: addressHash }, { address: addressHash }],
  });

  if (!addressData) {
    return NextResponse.json({ error: "Address not found" }, { status: 404 });
  }

  const filter = {
    $or: [{ "vin.addresses": addressHash }, { "vout.addresses": addressHash }],
  };

  const total = await db.collection("txs").countDocuments(filter);
  const txs = await db
    .collection("txs")
    .find(filter)
    .sort({ timestamp: -1 })
    .skip(offset)
    .limit(limit)
    .toArray();

  const transactions = txs.map((tx) => {
    const inputsFromAddress = (tx.vin || [])
      .filter(
        (vin: any) =>
          vin.address === addressHash || vin.addresses === addressHash,
      )
      .reduce((s: number, vin: any) => s + (vin.amount || 0), 0);

    const outputsToAddress = (tx.vout || [])
      .filter((vout: any) => vout.addresses === addressHash)
      .reduce((s: number, vout: any) => s + (vout.amount || 0), 0);

    const net = outputsToAddress - inputsFromAddress;
    const type = net >= 0 ? "received" : "sent";
    const amount = Math.abs(net);

    return {
      txid: tx.txid,
      timestamp: tx.timestamp,
      amount,
      type,
    };
  });

  return NextResponse.json({
    address: addressData.a_id || addressData.address,
    balance: addressData.balance,
    received: addressData.received || 0,
    sent: addressData.sent || 0,
    txCount: addressData.txs?.length || total,
    transactions,
    total,
    offset,
    limit,
    pageCount: Math.ceil(total / limit),
  });
}

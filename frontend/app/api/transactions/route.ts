import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { fetchUserTransactionsFromChain } from "../../../lib/transactions";

const CACHE_SECONDS = 15;

export async function GET(request: NextRequest) {
  const user = request.nextUrl.searchParams.get("user");
  if (!user || !ethers.isAddress(user)) {
    return NextResponse.json(
      { success: false, error: "Valid user address is required" },
      { status: 400 }
    );
  }

  try {
    const data = await fetchUserTransactionsFromChain(user);
    return NextResponse.json(
      { success: true, data, timestamp: Date.now() },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

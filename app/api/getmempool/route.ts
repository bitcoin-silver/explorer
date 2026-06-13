import { NextResponse } from 'next/server';
import { rpc } from '@/lib/rpc';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const verbose = searchParams.get('verbose') === 'true';

    const mempool = await rpc.getMempool(verbose);

    return NextResponse.json({
      mempool,
      count: verbose ? Object.keys(mempool).length : mempool.length,
      verbose
    });
  } catch (error) {
    console.error('Error fetching mempool:', error);
    return NextResponse.json(
      { error: 'Failed to fetch mempool' },
      { status: 500 }
    );
  }
}

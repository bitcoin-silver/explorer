import { NextResponse } from 'next/server';
import { rpc } from '@/lib/blockchain';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Use the getPeerInfo RPC call to get information about all connected peers
    const peerInfo = await rpc.getPeerInfo();
    
    return NextResponse.json(peerInfo, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('Error fetching peer info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch peer information' },
      { status: 500 }
    );
  }
}
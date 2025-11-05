import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { type NextRequest } from 'next/server';

// Define interfaces for transaction inputs and outputs
interface TxInput {
  address: string;
  addresses?: string;
  amount?: number;
  txid?: string;
  vout?: number;
}

interface TxOutput {
  addresses: string;
  amount: number;
}

export async function GET(request: NextRequest) {
  try {
    // Get address from query parameter
    const url = new URL(request.url);
    const addressHash = url.searchParams.get('address');
    
    if (!addressHash) {
      return NextResponse.json({ error: 'Address hash is required' }, { status: 400 });
    }
    
    const client = await clientPromise;
    const db = client.db();
    
    // Get address data
    const addressData = await db.collection('addresses').findOne({ 
      $or: [
        { a_id: addressHash },
        { address: addressHash }
      ] 
    });
    
    if (!addressData) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 });
    }
    
    // Get transactions for this address
    const txs = await db.collection('txs')
      .find({
        $or: [
          { 'vin.addresses': addressHash },
          { 'vout.addresses': addressHash }
        ]
      })
      .sort({ timestamp: -1 })
      .limit(1000)
      .toArray();
    
    return NextResponse.json({
      address: addressData.a_id || addressData.address,
      balance: addressData.balance,
      received: addressData.received || 0,
      sent: addressData.sent || 0,
      txCount: addressData.txs?.length || 0,
      transactions: txs.map(tx => {
        // Calculate total inputs from the queried address
        const inputsFromAddress = tx.vin
          .filter((vin: TxInput) => vin.address === addressHash || vin.addresses === addressHash)
          .reduce((sum: number, vin: TxInput) => sum + (vin.amount || 0), 0);

        // Calculate total outputs to the queried address
        const outputsToAddress = tx.vout
          .filter((vout: TxOutput) => vout.addresses === addressHash)
          .reduce((sum: number, vout: TxOutput) => sum + (vout.amount || 0), 0);

        // Calculate net effect on the address
        const netAmount = outputsToAddress - inputsFromAddress;

        // Determine type and amount
        const type = netAmount >= 0 ? 'received' : 'sent';
        const amount = Math.abs(netAmount);

        return {
          txid: tx.txid,
          timestamp: tx.timestamp,
          amount: amount,
          type: type
        };
      })
    });
  } catch (error) {
    console.error('Error fetching address data:', error);
    return NextResponse.json({ error: 'Failed to fetch address data' }, { status: 500 });
  }
}
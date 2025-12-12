import { rpc } from './rpc';

export async function getInfo() {
  try {
    return await rpc.getBlockchainInfo();
  } catch (error) {
    console.error('Error fetching blockchain info:', error);
    throw error;
  }
}

export async function getBlock(hashOrHeight: string | number) {
  try {
    // If height is provided, get block hash first
    const hash = typeof hashOrHeight === 'string' ? hashOrHeight : 
      await rpc.getBlockHash(hashOrHeight);
    
    // Now get the block with verbosity=2 (includes full tx data)
    return await rpc.getBlock(hash, 2);
  } catch (error) {
    console.error(`Error fetching block ${hashOrHeight}:`, error);
    throw error;
  }
}

export async function getTransaction(txid: string) {
  try {
    return await rpc.getRawTransaction(txid, true);
  } catch (error) {
    console.error(`Error fetching transaction ${txid}:`, error);
    throw error;
  }
}

export async function getNetworkInfo() {
  try {
    return await rpc.getNetworkInfo();
  } catch (error) {
    console.error('Error fetching network info:', error);
    throw error;
  }
}

export async function getPeerInfo() {
  try {
    return await rpc.getPeerInfo();
  } catch (error) {
    console.error('Error fetching peer info:', error);
    throw error;
  }
}

// Export rpc for direct access if needed
export { rpc };
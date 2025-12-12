import axios from 'axios';

interface RPCResponse {
  result?: any;
  error?: any;
  id?: string | number;
}

const rpcHost = process.env.WALLET_HOST || '127.0.0.1';
const rpcPort = process.env.WALLET_PORT || '10567';
const rpcUser = process.env.WALLET_USERNAME || '';
const rpcPass = process.env.WALLET_PASSWORD || '';

const rpcUrl = `http://${rpcHost}:${rpcPort}`;

console.log('RPC Config:', { rpcHost, rpcPort, rpcUser });

export async function rpcCall(method: string, params: any[] = []): Promise<any> {
  try {
    const response = await axios.post<RPCResponse>(
      rpcUrl,
      {
        jsonrpc: '1.0',
        id: `explorer-${Date.now()}`,
        method,
        params
      },
      {
        auth: { username: rpcUser, password: rpcPass },
        headers: {
          'content-type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
        },
        timeout: 30000
      }
    );

    if (response.data.error) {
      throw new Error(`RPC Error: ${response.data.error}`);
    }

    return response.data.result;
  } catch (error) {
    console.error(`RPC call failed for ${method}:`, error);
    throw error;
  }
}

// Convenience functions matching bitcoin-core interface
export const rpc = {
  getBlockchainInfo: () => rpcCall('getblockchaininfo'),
  getBlockHash: (height: number) => rpcCall('getblockhash', [height]),
  getBlock: (hash: string, verbosity: number = 2) => rpcCall('getblock', [hash, verbosity]),
  getRawTransaction: (txid: string, verbose: boolean = true) => rpcCall('getrawtransaction', [txid, verbose]),
  getNetworkInfo: () => rpcCall('getnetworkinfo'),
  getPeerInfo: () => rpcCall('getpeerinfo'),
  getNetworkHashPs: () => rpcCall('getnetworkhashps'),
  command: (method: string, params?: any[]) => rpcCall(method, params || [])
};

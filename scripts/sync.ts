import 'dotenv/config';
import clientPromise from '../lib/mongodb';
import client from '../lib/blockchain';
import fs from 'fs';
import path from 'path';
import { Db } from 'mongodb';
import {
  Block as DBBlock,
  Transaction as DBTransaction,
  TransactionInput,
  TransactionOutput,
  RichlistEntry
} from '../lib/models';
import {
  Block as RPCBlock,
  Transaction as RPCTransaction,
  TransactionOutput as RPCTransactionOutput
} from 'bitcoin-core';

interface AddressBalanceResult { balance: string | number; received: string | number; }

// --- CLI ---
let mode = 'update';
let database = 'index';

function usage() {
  console.log(`Usage: tsx scripts/sync.ts [database] [mode]`);
  console.log(`database: index | market`);
  console.log(`mode: update | check | reindex | reindex-rich | rebuild-address <address> | rebuild-all-addresses | range <start> <end>`);
  process.exit(0);
}

if (process.argv[2] === 'index') {
  if (process.argv.length < 4) usage();
  mode = process.argv[3];
} else if (process.argv[2] === 'market') {
  database = 'market';
} else usage();

// --- TMP / LOCK ---
const tmpDir = path.join(process.cwd(), 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

function createLock(cb: () => void) {
  if (database !== 'index') return cb();
  const fname = path.join(tmpDir, `${database}.pid`);
  fs.writeFile(fname, process.pid.toString(), err => { if (err) process.exit(1); cb(); });
}

function removeLock(cb: () => void) {
  if (database !== 'index') return cb();
  const fname = path.join(tmpDir, `${database}.pid`);
  fs.unlink(fname, () => cb());
}

function isLocked(cb: (locked: boolean) => void) {
  if (database !== 'index') return cb(false);
  const fname = path.join(tmpDir, `${database}.pid`);
  fs.access(fname, fs.constants.F_OK, err => cb(!err));
}

function exit() { removeLock(() => process.exit(0)); }

// --- BLOCKCHAIN SYNC ---
async function updateBlockchain(db: Db, start: number, end: number, timeout?: number) {
  console.log(`Syncing blocks ${start} → ${end}`);
  const BATCH = 10;
  for (let height = start; height <= end; height += BATCH) {
    const endHeight = Math.min(height + BATCH - 1, end);
    await syncBlockRange(db, height, endHeight);
    if (timeout) await new Promise(res => setTimeout(res, timeout));
  }
  await updateStats(db);
}

async function syncBlockRange(db: Db, startHeight: number, endHeight: number) {
  for (let h = startHeight; h <= endHeight; h++) {
    try {
      const blockHash = await client.getBlockHash(h);
      const existing = await db.collection('blocks').findOne({ hash: blockHash });
      if (existing) {
        if (mode === 'check') await verifyBlockTransactions(db, h, blockHash);
        continue;
      }
      const block = await client.getBlock(blockHash, 2) as RPCBlock;
      await processBlock(db, block);
    } catch (e) { console.error(`Block ${h} error:`, e); throw e; }
  }
}

async function processBlock(db: Db, block: RPCBlock) {
  let blockTotal = 0;
  const txids: string[] = [];

  for (const tx of block.tx) {
    const fullTx: RPCTransaction = typeof tx === 'string' ? await client.getRawTransaction(tx, true) as RPCTransaction : tx;
    txids.push(fullTx.txid);
    blockTotal += fullTx.vout.reduce((sum, v) => sum + Number(v.value), 0);
    await processTransaction(db, fullTx, block);
  }

  await db.collection<DBBlock>('blocks').insertOne({
    hash: block.hash,
    height: block.height,
    confirmations: block.confirmations,
    size: block.size,
    bits: block.bits,
    nonce: block.nonce,
    timestamp: block.time,
    difficulty: block.difficulty,
    merkle: block.merkleroot,
    prev_hash: block.previousblockhash,
    next_hash: block.nextblockhash,
    txs: txids,
    total: blockTotal
  } as DBBlock);
}

// --- TRANSACTIONS ---
interface InputAddressAmount { addresses: string; amount: number; }
interface OutputAddressAmount { addresses: string; amount: number; }

function extractAddress(vout: RPCTransactionOutput): string {
  if (vout.scriptPubKey.addresses?.length) return vout.scriptPubKey.addresses[0];
  if ((vout.scriptPubKey as any).address) return (vout.scriptPubKey as any).address;

  const hex = vout.scriptPubKey.hex || '';
  const type = vout.scriptPubKey.type || 'unknown';
  const asm = vout.scriptPubKey.asm || '';

  const shortHex = hex.slice(0, 12);
  const shortAsm = asm.length > 20 ? asm.slice(0, 20) + '…' : asm;

  return `script:${type}${shortHex ? `:${shortHex}` : ''}${shortAsm ? `:${shortAsm}` : ''}`;
}

async function processTransaction(db: Db, tx: RPCTransaction, block: RPCBlock) {
  if (await db.collection('txs').findOne({ txid: tx.txid })) return;

  const inputs: InputAddressAmount[] = [];
  for (const vin of tx.vin) {
    if (vin.coinbase) { 
      inputs.push({ addresses: 'coinbase', amount: 0 }); 
      continue; 
    }
    try {
      if (vin.txid == null || vin.vout == null) { 
        inputs.push({ addresses: 'unknown', amount: 0 }); 
        continue; 
      }

      let vinTx: RPCTransaction | null = null;
      for (let i = 0; i < 3; i++) {
        try {
          vinTx = await client.getRawTransaction(vin.txid, true) as RPCTransaction;
          break;
        } catch (e) {
          if (i === 2) throw e;
          await new Promise(res => setTimeout(res, 500));
        }
      }

      if (!vinTx || !vinTx.vout[vin.vout]) {
        inputs.push({ addresses: `script:unknown`, amount: 0 });
        continue;
      }

      const vinOut = vinTx.vout[vin.vout];
      inputs.push({ addresses: extractAddress(vinOut), amount: Number(vinOut.value) || 0 });

    } catch (e) {
      console.warn(`Failed to process vin ${vin.txid}:${vin.vout}`, e);
      inputs.push({ addresses: `script:unknown`, amount: 0 });
    }
  }

  const outputs: OutputAddressAmount[] = tx.vout
    .filter(v => !(v.value === 0 && v.scriptPubKey.type === 'nulldata'))
    .map(v => ({ addresses: extractAddress(v), amount: Number(v.value) }));

  const inputTotal = inputs.reduce((sum, i) => sum + i.amount, 0);
  const outputTotal = outputs.reduce((sum, o) => sum + o.amount, 0);
  const fee = tx.vin[0]?.coinbase ? 0 : Math.max(0, inputTotal - outputTotal);

  await db.collection<DBTransaction>('txs').insertOne({
    txid: tx.txid,
    blockindex: block.height,
    blockhash: block.hash,
    timestamp: block.time,
    total: outputTotal,
    fee,
    vin: inputs as TransactionInput[],
    vout: outputs as TransactionOutput[]
  } as unknown as DBTransaction);

  await updateAddressesFromTx(db, tx.txid, inputs, outputs, block.height);
}

// --- ADDRESS BALANCES ---
async function updateAddressesFromTx(db: Db, txid: string, inputs: InputAddressAmount[], outputs: OutputAddressAmount[], blockHeight: number) {
  const impacts: Record<string, { sent: number, received: number }> = {};
  const inputAddresses = new Set(inputs.filter(i => i.addresses !== 'coinbase' && i.addresses !== 'unknown').map(i => i.addresses));

  const addresstxsOps: any[] = [];
  const addressesOps: any[] = [];

  for (const out of outputs) {
    if (out.addresses === 'unknown') continue;

    const isChange = inputAddresses.has(out.addresses);
    if (!impacts[out.addresses]) impacts[out.addresses] = { sent: 0, received: 0 };
    impacts[out.addresses].received += out.amount;

    if (!isChange) {
      addresstxsOps.push({ insertOne: { document: { a_id: out.addresses, txid, blockindex: blockHeight, amount: out.amount, type: 'vout' } } });
    }
  }

  for (const inp of inputs) {
    if (inp.addresses === 'coinbase' || inp.addresses === 'unknown') continue;
    if (!impacts[inp.addresses]) impacts[inp.addresses] = { sent: 0, received: 0 };
    impacts[inp.addresses].sent += inp.amount;

    addresstxsOps.push({ insertOne: { document: { a_id: inp.addresses, txid, blockindex: blockHeight, amount: -inp.amount, type: 'vin' } } });
  }

  for (const [addr, imp] of Object.entries(impacts)) {
    addressesOps.push({
      updateOne: {
        filter: { a_id: addr },
        update: { 
          $inc: { balance: imp.received - imp.sent, received: imp.received, sent: imp.sent }, 
          $push: { txs: txid },
          $setOnInsert: { a_id: addr }
        },
        upsert: true
      }
    });
  }

  try { if (addresstxsOps.length) await db.collection('addresstxs').bulkWrite(addresstxsOps, { ordered: false }); } 
  catch (e) { console.error('Bulk addresstxs failed:', e); }

  try { if (addressesOps.length) await db.collection('addresses').bulkWrite(addressesOps, { ordered: false }); } 
  catch (e) { console.error('Bulk addresses failed:', e); }
}

// --- VERIFY BLOCK ---
async function verifyBlockTransactions(db: Db, height: number, blockHash: string) {
  const block = await client.getBlock(blockHash, 2) as RPCBlock;
  const txids = block.tx.map(tx => typeof tx === 'string' ? tx : tx.txid);

  const existing = await db.collection('txs').find({ blockhash: blockHash }).project<{ txid: string }>({ txid: 1 }).toArray();
  const existingSet = new Set(existing.map(e => e.txid));

  const missing = txids.filter(id => !existingSet.has(id));
  for (const txid of missing) {
    const fullTx = await client.getRawTransaction(txid, true) as RPCTransaction;
    await processTransaction(db, fullTx, block);
  }
}

// --- RICHLIST ---
async function updateRichlist(db: Db) {
  const top = await db.collection('addresses').find({ balance: { $gt: 0 } }).sort({ balance: -1 }).limit(100).toArray();
  const richlist = top.map(a => ({ address: a.a_id, balance: a.balance, received: a.received } as RichlistEntry));
  await db.collection('richlist').updateOne(
    { coin: process.env.NEXT_PUBLIC_COIN_SYMBOL },
    { $set: { balance: richlist, received: richlist }, $setOnInsert: { coin: process.env.NEXT_PUBLIC_COIN_SYMBOL } },
    { upsert: true }
  );
}

// --- STATS ---
async function updateStats(db: Db) {
  const info = await client.getBlockchainInfo();
  const net = await client.getNetworkInfo();
  let supply = await calculateSupplyFromBlocks(db).catch(() => 0);
  await db.collection('stats').updateOne(
    { coin: process.env.NEXT_PUBLIC_COIN_SYMBOL },
    { $set: { coin: process.env.NEXT_PUBLIC_COIN_SYMBOL, count: info.blocks, last: info.blocks, supply, connections: net.connections, difficulty: info.difficulty, hashrate: calculateHashrate(info.difficulty) } },
    { upsert: true }
  );
}

async function calculateSupplyFromBlocks(db: Db) {
  const res = await db.collection('txs').aggregate([
    { $match: { 'vin.0.addresses': 'coinbase' } },
    { $addFields: { totalNum: { $convert: { input: "$total", to: "double", onError: 0, onNull: 0 } } } },
    { $group: { _id: null, totalSupply: { $sum: "$totalNum" } } }
  ]).toArray();

  return res.length ? res[0].totalSupply : 0;
}

function calculateHashrate(diff: number) { return diff * Math.pow(2, 32) / 60; }

// --- REBUILD ADDRESS BALANCES ---
async function rebuildAddressBalances(db: Db, specific?: string) {
  const query = specific ? { a_id: specific } : {};
  const addrs = await db.collection('addresses').find(query).project({ a_id: 1 }).toArray();
  for (const addr of addrs) {
    try {
      const res = await client.command('getaddressbalance', { addresses: [addr.a_id] }) as AddressBalanceResult;
      const balance = Number(res.balance), received = Number(res.received), sent = received - balance;
      await db.collection('addresses').updateOne({ a_id: addr.a_id }, { $set: { balance, received, sent } });
    } catch (e) { console.error(`Failed ${addr.a_id}:`, e); }
  }
}

// --- ENTRY POINT ---
isLocked(locked => {
  if (locked) { console.log("Already running"); process.exit(0); }
  createLock(async () => {
    console.log("Sync launched PID", process.pid);
    const db = (await clientPromise).db();
    if (database === 'index') {
      const stats = await db.collection('stats').findOne({ coin: process.env.NEXT_PUBLIC_COIN_SYMBOL });
      const latest = (await client.getBlockchainInfo()).blocks;
      switch (mode) {
        case 'reindex':
          await db.collection('txs').deleteMany({});
          await db.collection('blocks').deleteMany({});
          await db.collection('addresses').deleteMany({});
          await db.collection('addresstxs').deleteMany({});
          await db.collection('richlist').updateOne({ coin: process.env.NEXT_PUBLIC_COIN_SYMBOL }, { $set: { balance: [], received: [] } }, { upsert: true });
          await updateBlockchain(db, 1, latest);
          await updateRichlist(db);
          break;
        case 'update':
          await updateBlockchain(db, (stats?.last || 0) + 1, latest);
          await updateRichlist(db);
          break;
        case 'check':
          await updateBlockchain(db, 1, latest, 1000);
          break;
        case 'reindex-rich':
          await updateStats(db);
          await updateRichlist(db);
          break;
        case 'rebuild-address':
          await rebuildAddressBalances(db, process.argv[4]);
          await updateRichlist(db);
          break;
        case 'rebuild-all-addresses':
          await rebuildAddressBalances(db);
          await updateRichlist(db);
          break;
        case 'range':
          const start = parseInt(process.argv[4]);
          const end = parseInt(process.argv[5]);
          await updateBlockchain(db, start, end);
          await updateRichlist(db);
          break;
        default:
          usage();
      }
    }
    exit();
  });
});

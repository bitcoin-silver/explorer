import 'dotenv/config';
import clientPromise from '../lib/mongodb';
import { rpc } from '../lib/blockchain';
import fs from 'fs';
import path from 'path';
import { Db } from 'mongodb';
import { Block as DBBlock, Transaction as DBTransaction, RichlistEntry } from '../lib/models';

let mode = 'update', database = 'index';
const tmpDir = path.join(process.cwd(), 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

if (process.argv[2] === 'index') mode = process.argv[3] || 'update';
else if (process.argv[2] === 'market') database = 'market';
else { console.log(`Usage: tsx scripts/sync.ts [database] [mode]`); process.exit(0); }

const lockFile = path.join(tmpDir, `${database}.pid`);
const createLock = (cb: () => void) => { if(database!=='index') return cb(); fs.writeFileSync(lockFile, process.pid.toString()); cb(); };
const removeLock = (cb: () => void) => { if(database!=='index') return cb(); fs.unlinkSync(lockFile); cb(); };
const isLocked = (cb: (locked: boolean) => void) => { if(database!=='index') return cb(false); cb(fs.existsSync(lockFile)); };
const exit = () => removeLock(() => process.exit(0));

function extractAddress(vout: any): string {
  const spk = vout.scriptPubKey;
  if (spk.addresses?.length) return spk.addresses[0];
  if (spk.address) return spk.address;
  return `script:${spk.type||'unknown'}${(spk.hex||'').slice(0,12)}`;
}

function calculateHashrate(diff: number) { return diff * 2**32 / 60; }

async function processTransaction(db: Db, tx: any, block: any) {
  if(await db.collection('txs').findOne({ txid: tx.txid })) return;

  const inputs: any[] = [];
  for(const vin of tx.vin){
    if(vin.coinbase){ inputs.push({ addresses:'coinbase',amount:0 }); continue; }
    if(!vin.txid || vin.vout==null){ inputs.push({addresses:'unknown',amount:0}); continue; }
    const vinTx = await rpc.getRawTransaction(vin.txid,true);
    const out = vinTx?.vout[vin.vout];
    inputs.push({ addresses: out? extractAddress(out) : 'script:unknown', amount: out? Number(out.value):0 });
  }

  const outputs = tx.vout.filter((v:any)=>!(v.value===0 && v.scriptPubKey.type==='nulldata'))
                        .map((v:any)=>({addresses:extractAddress(v),amount:Number(v.value)}));

  const inputTotal = inputs.reduce((s,i)=>s+i.amount,0);
  const outputTotal = outputs.reduce((s: any,o: { amount: any; })=>s+o.amount,0);
  const fee = tx.vin[0]?.coinbase?0:Math.max(0,inputTotal-outputTotal);

  await db.collection<Omit<DBTransaction,'_id'>>('txs').insertOne({
    txid:tx.txid,blockindex:block.height,blockhash:block.hash,
    timestamp:block.time,total:outputTotal,fee,
    vin:inputs,vout:outputs
  });

  await updateAddressesFromTx(db, tx.txid, inputs, outputs, block.height);
}

async function updateAddressesFromTx(db: Db, txid:string, inputs:any[], outputs:any[], blockHeight:number){
  const impacts: Record<string,{sent:number,received:number}>={};
  const addresstxsOps:any[]=[];

  for(const inp of inputs){
    if(inp.addresses==='coinbase'||inp.addresses==='unknown') continue;
    impacts[inp.addresses]??={sent:0,received:0};
    impacts[inp.addresses].sent+=inp.amount;
    addresstxsOps.push({insertOne:{document:{a_id:inp.addresses,txid,blockindex:blockHeight,amount:-inp.amount,type:'vin'}}});
  }

  const inputAddressesSet = new Set(inputs.map(i=>i.addresses));
  for(const out of outputs){
    if(out.addresses==='unknown') continue;
    impacts[out.addresses]??={sent:0,received:0};
    if(!inputAddressesSet.has(out.addresses)) impacts[out.addresses].received+=out.amount;
    addresstxsOps.push({insertOne:{document:{a_id:out.addresses,txid,blockindex:blockHeight,amount:out.amount,type:'vout'}}});
  }

  const addressesOps:any[]=[];
  for(const [addr,imp] of Object.entries(impacts)){
    addressesOps.push({
      updateOne:{
        filter:{a_id:addr},
        update:{$inc:{balance:imp.received-imp.sent,received:imp.received,sent:imp.sent},$push:{txs:txid},$setOnInsert:{a_id:addr}},
        upsert:true
      }
    });
  }

  const chunk = (arr:any[],size:number)=>{ const res=[]; for(let i=0;i<arr.length;i+=size) res.push(arr.slice(i,i+size)); return res; };
  for(const c of chunk(addresstxsOps,500)){ try{ await db.collection('addresstxs').bulkWrite(c,{ordered:false}); } catch(e){ console.error(e);} }
  for(const c of chunk(addressesOps,500)){ try{ await db.collection('addresses').bulkWrite(c,{ordered:false}); } catch(e){ console.error(e);} }
}

async function processBlock(db: Db, block: any){
  let total=0, txids:string[]=[];
  for(const tx of block.tx){
    const fullTx = typeof tx==='string'? await rpc.getRawTransaction(tx,true) : tx;
    txids.push(fullTx.txid);
    total += fullTx.vout.reduce((s: number,v: { value: any; })=>s+Number(v.value),0);
    await processTransaction(db, fullTx, block);
  }
  await db.collection<Omit<DBBlock,'_id'>>('blocks').insertOne({
    hash:block.hash,height:block.height,confirmations:block.confirmations,size:block.size,
    bits:block.bits,nonce:block.nonce,timestamp:block.time,difficulty:block.difficulty,
    merkle:block.merkleroot,prev_hash:block.previousblockhash,next_hash:block.nextblockhash,
    txs:txids,total
  });
}

async function updateBlockchain(db: Db, start: number, end: number){
  for(let height=start; height<=end; height++){
    try{
      const hash = await rpc.getBlockHash(height);
      if(await db.collection('blocks').findOne({ hash })) continue;
      const block = await rpc.getBlock(hash,2);
      await processBlock(db, block);
    }catch(e){ console.error(`Block ${height} error:`,e); throw e; }
  }
  await updateStats(db);
}

async function rebuildAddressBalances(db: Db, specific?: string){
  const query = specific ? { a_id: specific } : {};
  const addrs = await db.collection('addresses').find(query).project({ a_id: 1 }).toArray();
  for (const { a_id } of addrs){
    const txs = await db.collection('addresstxs').find({ a_id }).toArray();
    const byTx: Record<string, { vins: any[]; vouts: any[] }> = {};
    for (const e of txs){ byTx[e.txid] ??= { vins: [], vouts: [] }; if(e.type==='vin') byTx[e.txid].vins.push(e); else byTx[e.txid].vouts.push(e); }
    let balance=0, received=0, sent=0;
    for(const e of txs) balance+=Number(e.amount||0);
    for(const [_txid, bucket] of Object.entries(byTx)){
      const voutSum = bucket.vouts.reduce((s,v)=>s+Number(v.amount||0),0);
      const vinSumPositive = bucket.vins.reduce((s,v)=>s+Math.abs(Number(v.amount||0)),0);
      const changeToSelf = bucket.vouts.reduce((s,v)=>s+Number(v.amount||0),0);
      if(bucket.vins.length>0) sent += Math.max(0, vinSumPositive - changeToSelf); else received += voutSum;
    }
    await db.collection('addresses').updateOne({ a_id },{ $set:{ balance, received, sent }},{upsert:true });
  }
}

async function updateRichlist(db: Db){
  const top = await db.collection('addresses').find({balance:{$gt:0}}).sort({balance:-1}).limit(100).toArray();
  const richlist: RichlistEntry[] = top.map(a=>({address:a.a_id,balance:a.balance,received:a.received}));
  await db.collection('richlist').updateOne({coin:process.env.NEXT_PUBLIC_COIN_SYMBOL},{$set:{balance:richlist,received:richlist}},{upsert:true});
}

async function updateStats(db: Db){
  const info = await rpc.getBlockchainInfo();
  const net = await rpc.getNetworkInfo();
  const supply = await db.collection('txs').aggregate([
    {$match:{'vin.0.addresses':'coinbase'}},
    {$addFields:{totalNum:{$convert:{input:"$total",to:"double",onError:0,onNull:0}}}},
    {$group:{_id:null,totalSupply:{$sum:"$totalNum"}}}
  ]).toArray();
  await db.collection('stats').updateOne({coin:process.env.NEXT_PUBLIC_COIN_SYMBOL},{$set:{coin:process.env.NEXT_PUBLIC_COIN_SYMBOL,count:info.blocks,last:info.blocks,supply:supply[0]?.totalSupply||0,connections:net.connections,difficulty:info.difficulty,hashrate:calculateHashrate(info.difficulty)}},{upsert:true});
}

isLocked(locked=>{
  if(locked){ console.log("Already running"); process.exit(0);}
  createLock(async()=>{
    console.log("Sync launched PID",process.pid);
    const db = (await clientPromise).db();
    const stats = await db.collection('stats').findOne({coin:process.env.NEXT_PUBLIC_COIN_SYMBOL});
    const latest = (await rpc.getBlockchainInfo()).blocks;

    switch(mode){
      case 'reindex':
        await Promise.all([
          db.collection('txs').deleteMany({}),
          db.collection('blocks').deleteMany({}),
          db.collection('addresses').deleteMany({}),
          db.collection('addresstxs').deleteMany({}),
          db.collection('richlist').updateOne({coin:process.env.NEXT_PUBLIC_COIN_SYMBOL},{$set:{balance:[],received:[]}},{upsert:true})
        ]);
        await updateBlockchain(db,1,latest);
        await updateRichlist(db);
        break;
      case 'update':
        await updateBlockchain(db,(stats?.last||0)+1,latest);
        await updateRichlist(db);
        break;
      case 'check':
        await updateBlockchain(db,1,latest);
        break;
      case 'reindex-rich':
        await updateStats(db);
        await updateRichlist(db);
        break;
      case 'rebuild-address':
        await rebuildAddressBalances(db,process.argv[4]);
        await updateRichlist(db);
        break;
      case 'rebuild-all-addresses':
        await rebuildAddressBalances(db);
        await updateRichlist(db);
        break;
      default: console.log(`Usage: tsx scripts/sync.ts [database] [mode]`); process.exit(0);
    }
    exit();
  });
});

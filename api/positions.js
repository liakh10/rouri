/* Positions poured through Rouri. Uniswap v4 position NFTs are not enumerable, so after a mint the page posts
   the transaction hash; the server reads the receipt from Robinhood Chain and records the minted token id for
   its owner. Everything shown about a position is then read live from the chain.
   GET  /api/positions?owner=0x…      token ids recorded for that wallet (still owned)
   POST /api/positions { tx }          record the position minted in that transaction
   POST /api/positions { id }          add an existing position by its id */
import { createPublicClient, http, fallback, decodeEventLog, getAddress } from 'viem';
import { ADDR } from '../lib/v4.js';
import { redis } from '../lib/store.js';

const chain = { id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } } };
const pub = createPublicClient({ chain, transport: fallback(['https://rpc.mainnet.chain.robinhood.com', 'https://robinhood-rpc.publicnode.com'].map(u => http(u, { timeout: 20000 }))) });
const TRANSFER = { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'id', type: 'uint256', indexed: true }] };
const OWNER = [{ type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] }];
const send = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(obj)); };

async function add(owner, id) {
  const R = redis(), k = 'rouri:pos:' + owner.toLowerCase(), cur = JSON.parse((await R.get(k)) || '[]');
  if (!cur.includes(id)) { cur.push(id); await R.set(k, JSON.stringify(cur.slice(-200))); }
  return cur;
}

export default async function handler(req, res) {
  try {
    const R = redis();
    if (req.method === 'GET') {
      const q = req.query || {};
      if (!/^0x[0-9a-fA-F]{40}$/.test(q.owner || '')) throw Error('Owner address is required.');
      const owner = getAddress(q.owner), ids = JSON.parse((await R.get('rouri:pos:' + owner.toLowerCase())) || '[]');
      const owners = await Promise.all(ids.map(id => pub.readContract({ address: ADDR.positionManager, abi: OWNER, functionName: 'ownerOf', args: [BigInt(id)] }).catch(() => null)));
      return send(res, 200, { owner, ids: ids.filter((id, i) => owners[i] && getAddress(owners[i]) === owner) });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const ip = String(req.headers['x-forwarded-for'] || 'local').split(',')[0].trim(), rl = 'rouri:rl:' + ip, hits = await R.incr(rl);
    if (hits === 1) await R.expire(rl, 60);
    if (hits > 30) throw Error('Too many requests, wait a minute.');
    if (/^0x[0-9a-fA-F]{64}$/.test(b.tx || '')) {
      const rc = await pub.waitForTransactionReceipt({ hash: b.tx, timeout: 20000, retryCount: 2 }).catch(() => { throw Error('Transaction not found on Robinhood Chain yet. Try again in a moment.'); });
      if (rc.status !== 'success') throw Error('That transaction reverted.');
      const minted = [];
      for (const l of rc.logs) {
        if (l.address.toLowerCase() !== ADDR.positionManager.toLowerCase()) continue;
        try { const d = decodeEventLog({ abi: [TRANSFER], data: l.data, topics: l.topics }); if (d.args.from === '0x0000000000000000000000000000000000000000') minted.push({ owner: d.args.to, id: d.args.id.toString() }); } catch {}
      }
      if (!minted.length) throw Error('No Uniswap v4 position was minted in that transaction.');
      for (const m of minted) await add(m.owner, m.id);
      return send(res, 200, { ok: true, minted });
    }
    if (/^\d{1,12}$/.test(String(b.id || ''))) {
      const owner = await pub.readContract({ address: ADDR.positionManager, abi: OWNER, functionName: 'ownerOf', args: [BigInt(b.id)] }).catch(() => { throw Error('Position #' + b.id + ' does not exist or was withdrawn.'); });
      await add(owner, String(b.id));
      return send(res, 200, { ok: true, owner, id: String(b.id) });
    }
    throw Error('Send a transaction hash or a position id.');
  } catch (e) { send(res, 400, { error: e.shortMessage || e.message }); }
}

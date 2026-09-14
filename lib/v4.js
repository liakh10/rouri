/* Uniswap v4 on Robinhood Chain for Rouri: addresses (verified on chain 4663), full-range liquidity math and
   the action encodings pour.market uses. Call makeV4(viem) with the viem module (npm or CDN build). */
export const ADDR = {
  poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
  positionManager: '0x58daec3116aae6D93017bAAea7749052E8a04fA7',
  stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11'
};
export const NATIVE = '0x0000000000000000000000000000000000000000';
export const TIERS = { standard: { fee: 3000, tickSpacing: 60, label: '0.30%' }, wild: { fee: 10000, tickSpacing: 200, label: '1.00% wild' } };
export const Q96 = 1n << 96n;
const MAX_TICK = 887272;
export const fullRange = ts => ({ tickLower: Math.ceil(-MAX_TICK / ts) * ts, tickUpper: Math.floor(MAX_TICK / ts) * ts });

/* TickMath.getSqrtPriceAtTick */
export function sqrtAtTick(tick) {
  const abs = BigInt(Math.abs(tick));
  if (abs > BigInt(MAX_TICK)) throw Error('tick out of range');
  let p = (abs & 1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  const M = [
    [0x2n, 0xfff97272373d413259a46990580e213an], [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn], [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10n, 0xffcb9843d60f6159c9db58835c926644n], [0x20n, 0xff973b41fa98c081472e6896dfb254c0n], [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n], [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n], [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n], [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n], [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n], [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n], [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n], [0x20000n, 0x5d6af8dedb81196699c329225ee604n], [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n]
  ];
  for (const [bit, mul] of M) if ((abs & bit) !== 0n) p = (p * mul) >> 128n;
  if (tick > 0) p = ((1n << 256n) - 1n) / p;
  return (p >> 32n) + (p % (1n << 32n) === 0n ? 0n : 1n);
}

/* integer square root for opening prices */
export function isqrt(n) {
  if (n < 2n) return n;
  /* Newton from a power of two above the root: decreases monotonically to floor(sqrt(n)) */
  let x = 1n << (BigInt(n.toString(2).length) / 2n + 1n);
  for (;;) { const y = (x + n / x) >> 1n; if (y >= x) return x; x = y; }
}
/* price of 1 whole currency1 in currency0 units → sqrtPriceX96 for a pool where amount1/amount0 is the ratio */
export const sqrtFromAmounts = (amount0, amount1) => isqrt((amount1 << 192n) / amount0);

const l0 = (a, b, amt) => { if (a > b) [a, b] = [b, a]; return amt * (a * b / Q96) / (b - a); };
const l1 = (a, b, amt) => { if (a > b) [a, b] = [b, a]; return amt * Q96 / (b - a); };
export function liquidityForAmounts(sqrtP, sqrtA, sqrtB, amount0, amount1) {
  if (sqrtP <= sqrtA) return l0(sqrtA, sqrtB, amount0);
  if (sqrtP < sqrtB) { const x = l0(sqrtP, sqrtB, amount0), y = l1(sqrtA, sqrtP, amount1); return x < y ? x : y; }
  return l1(sqrtA, sqrtB, amount1);
}
const divUp = (a, b) => a === 0n ? 0n : (a - 1n) / b + 1n;
/* amounts needed for liquidity L, rounded up the way the pool manager settles a mint */
export function amountsForLiquidity(sqrtP, sqrtA, sqrtB, L) {
  let a0 = 0n, a1 = 0n;
  if (sqrtP <= sqrtA) a0 = divUp(divUp(L * Q96 * (sqrtB - sqrtA), sqrtB), sqrtA);
  else if (sqrtP < sqrtB) { a0 = divUp(divUp(L * Q96 * (sqrtB - sqrtP), sqrtB), sqrtP); a1 = divUp(L * (sqrtP - sqrtA), Q96); }
  else a1 = divUp(L * (sqrtB - sqrtA), Q96);
  return { amount0: a0, amount1: a1 };
}
/* amounts a position of liquidity L is worth now, rounded down */
export function amountsOut(sqrtP, sqrtA, sqrtB, L) {
  if (sqrtP <= sqrtA) return { amount0: L * Q96 * (sqrtB - sqrtA) / sqrtB / sqrtA, amount1: 0n };
  if (sqrtP < sqrtB) return { amount0: L * Q96 * (sqrtB - sqrtP) / sqrtB / sqrtP, amount1: L * (sqrtP - sqrtA) / Q96 };
  return { amount0: 0n, amount1: L * (sqrtB - sqrtA) / Q96 };
}
/* token price in ETH units (whole token → ETH) from sqrtPriceX96, token as currency1 */
export const ethPerToken = (sqrtP, dec0 = 18, dec1 = 18) => { const num = Q96 * Q96 * 10n ** BigInt(dec1), den = sqrtP * sqrtP * 10n ** BigInt(dec0); return Number(num * 10n ** 18n / den) / 1e18; };

export function makeV4(viem) {
  const { encodeAbiParameters, encodeFunctionData, keccak256, concatHex, numberToHex } = viem;
  const KEY = { type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] };
  const PM_ABI = [
    { type: 'function', name: 'multicall', stateMutability: 'payable', inputs: [{ name: 'data', type: 'bytes[]' }], outputs: [{ type: 'bytes[]' }] },
    { type: 'function', name: 'initializePool', stateMutability: 'payable', inputs: [{ name: 'key', ...KEY }, { name: 'sqrtPriceX96', type: 'uint160' }], outputs: [{ type: 'int24' }] },
    { type: 'function', name: 'modifyLiquidities', stateMutability: 'payable', inputs: [{ name: 'unlockData', type: 'bytes' }, { name: 'deadline', type: 'uint256' }], outputs: [] },
    { type: 'function', name: 'nextTokenId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
    { type: 'function', name: 'getPositionLiquidity', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint128' }] },
    { type: 'function', name: 'getPoolAndPositionInfo', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ name: 'poolKey', ...KEY }, { name: 'info', type: 'uint256' }] },
    { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'id', type: 'uint256', indexed: true }] }
  ];
  const SV_ABI = [
    { type: 'function', name: 'getSlot0', stateMutability: 'view', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' }, { name: 'protocolFee', type: 'uint24' }, { name: 'lpFee', type: 'uint24' }] },
    { type: 'function', name: 'getLiquidity', stateMutability: 'view', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [{ type: 'uint128' }] },
    { type: 'function', name: 'getFeeGrowthInside', stateMutability: 'view', inputs: [{ name: 'poolId', type: 'bytes32' }, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }], outputs: [{ name: 'feeGrowthInside0X128', type: 'uint256' }, { name: 'feeGrowthInside1X128', type: 'uint256' }] },
    { type: 'function', name: 'getPositionInfo', stateMutability: 'view', inputs: [{ name: 'poolId', type: 'bytes32' }, { name: 'owner', type: 'address' }, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }, { name: 'salt', type: 'bytes32' }], outputs: [{ name: 'liquidity', type: 'uint128' }, { name: 'feeGrowthInside0LastX128', type: 'uint256' }, { name: 'feeGrowthInside1LastX128', type: 'uint256' }] }
  ];
  const PERMIT2_ABI = [
    { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }], outputs: [] },
    { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'address' }], outputs: [{ name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }] }
  ];
  const A = { MINT: 0x02, BURN: 0x03, DECREASE: 0x01, SETTLE_PAIR: 0x0d, TAKE_PAIR: 0x11, SWEEP: 0x14 };
  const poolKey = (token, tier) => ({ currency0: NATIVE, currency1: token, fee: TIERS[tier].fee, tickSpacing: TIERS[tier].tickSpacing, hooks: NATIVE });
  const poolId = k => keccak256(encodeAbiParameters([KEY], [k]));
  const unlock = (actions, params) => encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [concatHex(actions.map(a => numberToHex(a, { size: 1 }))), params]);
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 900);

  function mintCalldata({ key, tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, init }) {
    const params = [
      encodeAbiParameters([KEY, { type: 'int24' }, { type: 'int24' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'address' }, { type: 'bytes' }], [key, tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, '0x']),
      encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [key.currency0, key.currency1]),
      encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [NATIVE, owner])
    ];
    const modify = encodeFunctionData({ abi: PM_ABI, functionName: 'modifyLiquidities', args: [unlock([A.MINT, A.SETTLE_PAIR, A.SWEEP], params), deadline()] });
    if (!init) return { data: modify, value: amount0Max };
    const initData = encodeFunctionData({ abi: PM_ABI, functionName: 'initializePool', args: [key, init] });
    return { data: encodeFunctionData({ abi: PM_ABI, functionName: 'multicall', args: [[initData, modify]] }), value: amount0Max };
  }
  function collectCalldata({ tokenId, key, recipient }) {
    const params = [
      encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }], [tokenId, 0n, 0n, 0n, '0x']),
      encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }], [key.currency0, key.currency1, recipient])
    ];
    return encodeFunctionData({ abi: PM_ABI, functionName: 'modifyLiquidities', args: [unlock([A.DECREASE, A.TAKE_PAIR], params), deadline()] });
  }
  function withdrawCalldata({ tokenId, key, recipient, amount0Min, amount1Min }) {
    const params = [
      encodeAbiParameters([{ type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }], [tokenId, amount0Min, amount1Min, '0x']),
      encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }], [key.currency0, key.currency1, recipient])
    ];
    return encodeFunctionData({ abi: PM_ABI, functionName: 'modifyLiquidities', args: [unlock([A.BURN, A.TAKE_PAIR], params), deadline()] });
  }
  const signed24 = v => (v & 0x800000n) ? Number(v) - 0x1000000 : Number(v);
  const decodeInfo = info => ({ tickLower: signed24((info >> 8n) & 0xffffffn), tickUpper: signed24((info >> 32n) & 0xffffffn) });
  const owed = (inside, last, L) => ((inside - last) & ((1n << 256n) - 1n)) * L >> 128n;
  return { KEY, PM_ABI, SV_ABI, PERMIT2_ABI, poolKey, poolId, mintCalldata, collectCalldata, withdrawCalldata, decodeInfo, owed };
}

import { describe, expect, it } from 'vitest';
import { BANK_POSITIONS, VEHICLES, createGame, deserializeGame, dispatch, formatMoney, getDiceCount, getNetWorth, getNpcAction, getRent, serializeGame } from './engine';
import type { GameState } from './game-types';

function onTile(position: number): GameState { const s = createGame({ seed: 'test', seats: 2 }); s.players[0].position = position; s.phase = 'action'; return s; }
function walkTo(s: GameState, position: number): GameState { s.players[s.currentPlayer].position = (position + 47) % 48; s.phase = 'moving'; s.pendingSteps = 1; s.die = 1; s.dice = [1]; return dispatch(s, { type: 'step' }); }
function assertSolvent(s: GameState) {
  for (const p of s.players) { expect(Number.isSafeInteger(p.cash) && p.cash >= 0).toBe(true); expect(Number.isSafeInteger(p.deposit) && p.deposit >= 0).toBe(true); for (const st of s.stocks) { expect(Number.isSafeInteger(p.holdings[st.id]) && p.holdings[st.id] >= 0).toBe(true); expect(Number.isSafeInteger(p.costBasis[st.id]) && p.costBasis[st.id] >= 0).toBe(true); } }
}

describe('board and money model', () => {
  it('has exactly 48 tiles, 24 properties, six evenly spaced banks and every planned facility', () => {
    const s = createGame(); const counts: Record<string, number> = {}; s.tiles.forEach(t => counts[t.type] = (counts[t.type] ?? 0) + 1);
    expect(s.tiles).toHaveLength(48); expect(s.tiles.filter(t => t.type === 'bank').map(t => t.id)).toEqual(BANK_POSITIONS);
    expect(counts).toEqual({ start: 1, property: 24, bank: 6, event: 4, shop: 2, station: 2, prison: 1, amusement: 2, park: 2, tax: 1, police: 1, auction: 1, construction: 1 });
    expect(new Set(s.players.map(p => p.theme)).size).toBe(4);
  });
  it('uses explicit 萬元 amounts and fills only empty seats with NPCs', () => {
    expect(formatMoney(4000)).toBe('400 萬元'); expect(formatMoney(12000)).toBe('1,200 萬元'); expect(formatMoney(25)).toBe('2.5 萬元');
    const s = createGame({ humanNames: ['小花', '小明'], seats: 4 }); expect(s.players.filter(p => !p.isNpc)).toHaveLength(2); expect(s.players[2].name).toBe('Labu');
    expect(() => createGame({ seats: 2, humanNames: ['a', 'b', 'c'] })).toThrow(); expect(() => createGame({ humanNames: [''] })).toThrow();
  });
});

describe('movement and market', () => {
  it('updates all market histories exactly once per step, not per roll or animation duration', () => {
    let s = createGame({ seed: 'steps' }); s.players[0].cards.push('loadedDice'); s = dispatch(s, { type: 'useCard', card: 'loadedDice', value: 5 }); s = dispatch(s, { type: 'roll' });
    expect(s.die).toBe(5); expect(s.marketTick).toBe(0); expect(s.phase).toBe('moving');
    for (let i = 1; i <= 5; i++) { s = dispatch(s, { type: 'step' }); expect(s.marketTick).toBe(i); expect(s.stocks.every(st => st.history.length === i + 1)).toBe(true); expect(s.players[0].position).toBe(i); }
    expect(s.phase).toBe('action'); expect(() => dispatch(s, { type: 'step' })).toThrow();
  });
  it('NPC and humans use identical stock updates; exact seeds reproduce a game', () => {
    const a = createGame({ seed: 'same' }); const b = createGame({ seed: 'same' }); b.players[0].isNpc = true;
    const movedA = walkTo(a, 3), movedB = walkTo(b, 3); expect(movedA.stocks).toEqual(movedB.stocks); expect(movedA.rngState).toBe(movedB.rngState);
  });
  it('pays one start salary on crossing and station teleports do not update stocks or pay salary', () => {
    let s = walkTo(createGame(), 0); expect(s.players[0].cash).toBe(10800); expect(s.marketTick).toBe(1);
    s = onTile(33); const stocks = structuredClone(s.stocks); s = dispatch(s, { type: 'station' }); expect(s.players[0].position).toBe(9); expect(s.marketTick).toBe(0); expect(s.stocks).toEqual(stocks); expect(s.players[0].cash).toBe(9900); expect(() => dispatch(s, { type: 'station' })).toThrow();
  });
  it('does not trigger banks or facilities simply passed during movement', () => {
    let s = createGame(); s.players[0].position = 2; s.phase = 'moving'; s.pendingSteps = 2; s.die = 2;
    s = dispatch(s, { type: 'step' }); expect(s.players[0].position).toBe(3); expect(dispatch(s, { type: 'withdraw', amount: 100 }).players[0].mobileBankUses).toBe(1); s = dispatch(s, { type: 'step' }); expect(s.players[0].position).toBe(4);
  });
});

describe('bank settlement', () => {
  it('rejects invalid money amounts, overflow, and unauthorized non-financial actions without mutation', () => {
    const s = onTile(1); const before = serializeGame(s);
    expect(dispatch(s, { type: 'deposit', amount: 10 }).players[0].mobileBankUses).toBe(1); expect(serializeGame(s)).toBe(before);
    const bank = onTile(3);
    for (const amount of [-1, 0, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => dispatch(bank, { type: 'deposit', amount })).toThrow();
    expect(() => dispatch(bank, { type: 'buyStock', stockId: 'stock-0', quantity: 1.1 })).toThrow(); expect(() => dispatch(bank, { type: 'buyStock', stockId: 'stock-0', quantity: Number.MAX_SAFE_INTEGER })).toThrow();
    expect(() => dispatch(bank, { type: 'buy', actorId: 'player-1' })).toThrow('現在不是你的回合');
    expect(() => dispatch(bank, { type: 'roll' })).toThrow();
  });
  it('moves funds and buys/sells at the current bank price without market drift', () => {
    let s = onTile(3); const wealth = getNetWorth(s, s.players[0]);
    s = dispatch(s, { type: 'deposit', amount: 1000 }); expect(s.players[0].cash).toBe(9000); expect(s.players[0].deposit).toBe(3000);
    s = dispatch(s, { type: 'buyStock', stockId: 'stock-0', quantity: 10 }); expect(s.players[0].deposit).toBe(2700); expect(s.players[0].holdings['stock-0']).toBe(10); expect(s.players[0].costBasis['stock-0']).toBe(300);
    s = dispatch(s, { type: 'sellStock', stockId: 'stock-0', quantity: 4 }); expect(s.players[0].deposit).toBe(2820); expect(s.players[0].costBasis['stock-0']).toBe(180);
    s = dispatch(s, { type: 'withdraw', amount: 820 }); expect(s.players[0].cash).toBe(9820); expect(s.marketTick).toBe(0); expect(getNetWorth(s, s.players[0])).toBe(wealth);
    expect(() => dispatch(s, { type: 'sellStock', stockId: 'stock-0', quantity: 7 })).toThrow('持股不足');
  });
  it('tracks realized gains and exact aggregate cost through partial sales', () => {
    let s = onTile(3); s = dispatch(s, { type: 'buyStock', stockId: 'stock-0', quantity: 3 }); s.stocks[0].price = 31; s = dispatch(s, { type: 'buyStock', stockId: 'stock-0', quantity: 2 });
    expect(s.players[0].costBasis['stock-0']).toBe(152);
    s.stocks[0].price = 40; s = dispatch(s, { type: 'sellStock', stockId: 'stock-0', quantity: 2 }); s = dispatch(s, { type: 'sellStock', stockId: 'stock-0', quantity: 3 });
    expect(s.players[0].costBasis['stock-0']).toBe(0); expect(s.players[0].realizedProfit).toBe(48);
  });
  it('rejects unsafe imported financial aggregates and rejects overflowing actions atomically', () => {
    const s = onTile(3); s.players[0].deposit = Number.MAX_SAFE_INTEGER; expect(() => deserializeGame(serializeGame(s))).toThrow();
    const before = serializeGame(s); expect(() => dispatch(s, { type: 'deposit', amount: 1 })).toThrow(); expect(serializeGame(s)).toBe(before);
    s.players[0].deposit = 1000; s.players[0].holdings['stock-0'] = Number.MAX_SAFE_INTEGER; expect(() => deserializeGame(serializeGame(s))).toThrow();
  });
  it('preserves total cost exactly for large holdings even when intermediate multiplication exceeds safe integer range', () => {
    let s = onTile(3); const quantity = 1_000_000_003; const basis = 9_000_000_000_000_001; s.players[0].holdings['stock-0'] = quantity; s.players[0].costBasis['stock-0'] = basis;
    s = deserializeGame(serializeGame(s)); s = dispatch(s, { type: 'sellStock', stockId: 'stock-0', quantity: quantity - 1 }); s = dispatch(s, { type: 'sellStock', stockId: 'stock-0', quantity: 1 });
    expect(s.players[0].costBasis['stock-0']).toBe(0); expect(s.players[0].realizedProfit).toBe(quantity * s.stocks[0].price - basis);
  });
});

describe('property and required payments', () => {
  it('purchases and upgrades once per visit and prevents spending another player’s funds', () => {
    let s = onTile(1); s = dispatch(s, { type: 'buy' }); s = dispatch(s, { type: 'upgrade' }); expect(s.tiles[1].ownerId).toBe('player-0'); expect(s.tiles[1].level).toBe(1);
    expect(() => dispatch(s, { type: 'upgrade' })).toThrow(); expect(() => dispatch(s, { type: 'buy' })).toThrow(); expect(() => dispatch(onTile(47), { type: 'upgrade', tileId: 1 })).toThrow();
  });
  it('draws only the missing rent from deposits and transfers exactly the amount paid', () => {
    const s = createGame({ seats: 2 }); s.tiles[1].ownerId = 'player-1'; s.players[0].cash = 10; const rent = getRent(s.tiles[1]); const moved = walkTo(s, 1);
    expect(moved.players[0].cash).toBe(0); expect(moved.players[0].deposit).toBe(2000 - rent + 10); expect(moved.players[1].cash).toBe(10000 + rent); expect(moved.players[0].bankrupt).toBe(false);
  });
  it('automatically uses rent protection without deducting funds', () => {
    const s = createGame(); s.tiles[1].ownerId = 'player-1'; s.players[0].cards.push('rentShield'); const moved = walkTo(s, 1); expect(moved.players[0].cash).toBe(10000); expect(moved.players[0].cards).toEqual([]);
  });
  it('liquidates stocks then property for insolvent payments, avoiding negative money', () => {
    const s = createGame(); s.tiles[1].ownerId = 'player-1'; s.tiles[1].level = 3; s.tiles[2].ownerId = 'player-0'; s.players[0].cash = 0; s.players[0].deposit = 0; s.players[0].holdings['stock-0'] = 1; s.players[0].costBasis['stock-0'] = 30;
    const moved = walkTo(s, 1); expect(moved.players[0].holdings['stock-0']).toBe(0); expect(moved.tiles[2].ownerId).toBeNull(); expect(moved.players[0].bankrupt).toBe(true); assertSolvent(moved);
  });
  it('ends immediately when the last rival bankrupts; creditor receives only available funds', () => {
    const s = createGame({ seats: 2 }); s.tiles[1].ownerId = 'player-1'; s.players[0].cash = 10; s.players[0].deposit = 0; const moved = walkTo(s, 1);
    expect(moved.players[0].bankrupt).toBe(true); expect(moved.players[1].cash).toBe(10010); expect(moved.phase).toBe('finished'); expect(moved.winner).toBe('player-1'); expect(() => dispatch(moved, { type: 'finishTurn' })).toThrow();
  });
});

describe('facilities and turn progression', () => {
  it('ordinary prison visitors are not jailed; police teleport counts only the single actual step', () => {
    expect(walkTo(createGame(), 12).players[0].jailTurns).toBe(0); const s = walkTo(createGame(), 24); expect(s.players[0].position).toBe(12); expect(s.players[0].jailTurns).toBe(2); expect(s.marketTick).toBe(1);
  });
  it('jail expires on two shared calendar round boundaries, not repeated rolls', () => {
    let s = createGame({seats:2}); s.players[0].position=12; s.players[0].jailTurns=2;
    s=dispatch(s,{type:'roll'}); expect(s.players[0].jailTurns).toBe(2); expect(s.marketTick).toBe(0);
    s=dispatch(s,{type:'finishTurn'}); s.phase='action'; s=dispatch(s,{type:'finishTurn'});
    expect(s.round).toBe(2); expect(s.players[0].jailTurns).toBe(1);
    s=dispatch(s,{type:'roll'}); expect(s.phase).toBe('action');
    s=dispatch(s,{type:'finishTurn'}); s.phase='action'; s=dispatch(s,{type:'finishTurn'});
    expect(s.players[0].jailTurns).toBe(0); expect(s.marketTick).toBe(0);
    s=dispatch(s,{type:'roll'}); expect(s.phase).toBe('moving');
  });
  it('a jail card or cash bail releases before a roll', () => {
    const s = createGame(); s.players[0].position = 12; s.players[0].jailTurns = 2; s.players[0].cards.push('jailFree');
    expect(dispatch(s, { type: 'useCard', card: 'jailFree' }).players[0].jailTurns).toBe(0); const bailed = dispatch(s, { type: 'bail' }); expect(bailed.players[0].cash).toBe(9700); expect(dispatch(bailed, { type: 'roll' }).phase).toBe('moving');
  });
  it('validates auction minimums, settles one winner, and cannot replay', () => {
    let s = onTile(36); s.auctionTileId = 1; s.players[1].cash = 0; const bid = Math.floor(s.tiles[1].price * .65);
    expect(() => dispatch(s, { type: 'auction', bid: bid - 1 })).toThrow(); s = dispatch(s, { type: 'auction', bid }); expect(s.tiles[1].ownerId).toBe('player-0'); expect(s.players[0].cash).toBe(10000 - bid); expect(() => dispatch(s, { type: 'auction', bid })).toThrow();
  });
  it('counts complete rounds and evaluates remaining stock at final market price', () => {
    let s = createGame({ seats: 2, maxRounds: 1 }); s.phase = 'action'; s.players[1].holdings['stock-0'] = 100; s.players[1].costBasis['stock-0'] = 3000;
    s = dispatch(s, { type: 'finishTurn' }); expect(s.round).toBe(1); expect(s.currentPlayer).toBe(1); s.phase = 'action'; s = dispatch(s, { type: 'finishTurn' }); expect(s.phase).toBe('finished'); expect(s.winner).toBe('player-1'); expect(s.round).toBe(1);
  });
});

describe('save validation and complete games', () => {
  it('roundtrips current state and rejects invalid money, ownership, board geometry, stock values, and serialized scripts', () => {
    const s = createGame(); expect(deserializeGame(serializeGame(s))).toEqual(s);
    for (const mutate of [(x: GameState) => { x.players[0].cash = -1; }, (x: GameState) => { x.tiles[3].type = 'property'; }, (x: GameState) => { x.tiles[1].ownerId = 'missing'; }, (x: GameState) => { x.stocks[0].price = .1; }, (x: GameState) => { x.currentPlayer = 9; }, (x: GameState) => { x.players[0].costBasis['stock-0'] = 1; }]) { const copy = structuredClone(s); mutate(copy); expect(() => deserializeGame(JSON.stringify(copy))).toThrow(); }
    expect(() => deserializeGame('<script>alert(1)</script>')).toThrow();
  });
  it('completes 40 seeded NPC games with integer assets, valid saves, and bounded action counts', () => {
    for (let seed = 0; seed < 40; seed++) {
      let s = createGame({ seed, seats: (2 + seed % 3) as 2 | 3 | 4, maxRounds: 12, players: [{ name: 'Labu', isNpc: true }] });
      let actions = 0;
      while (s.phase !== 'finished' && actions < 2000) {
        const action = getNpcAction(s); expect(action).not.toBeNull(); s = dispatch(s, action!); assertSolvent(s); if (actions % 25 === 0) expect(deserializeGame(serializeGame(s))).toEqual(s); actions++;
      }
      expect(s.phase, `seed ${seed}, ${actions} actions`).toBe('finished'); expect(actions).toBeLessThan(2000); expect(s.winner).not.toBeNull(); expect(deserializeGame(serializeGame(s))).toEqual(s);
    }
  }, 20000);
  it('returns deterministic NPC actions without mutating state or drawing RNG', () => {
    const s = onTile(3); const before = serializeGame(s); expect(getNpcAction(s)).toEqual(getNpcAction(s)); expect(serializeGame(s)).toBe(before);
  });
});

describe('transport and multiple dice', () => {
  it('offers two-dice bikes/scooters and three-dice cars at higher game prices', () => {
    expect(VEHICLES.map(v => v.id)).toEqual(['bicycle', 'scooter', 'city-car', 'tesla-model-3', 'tesla-model-y']);
    expect(VEHICLES.filter(v => v.kind !== 'car').every(v => v.diceCount === 2)).toBe(true);
    expect(VEHICLES.filter(v => v.kind === 'car').every(v => v.diceCount === 3 && v.price > VEHICLES[1].price)).toBe(true);
    expect(getDiceCount(createGame().players[0])).toBe(1);
  });
  it('rolls reproducible one/two/three-dice totals and updates every market exactly once per traversed square', () => {
    const faces: number[][] = [];
    for (const vehicleId of [null, 'bicycle', 'tesla-model-3']) {
      let s = createGame({ seed: 'transport-dice' }); if (vehicleId) { s.players[0].vehicles = [vehicleId]; s = dispatch(s, { type: 'equipVehicle', vehicleId }); }
      s = dispatch(s, { type: 'roll' }); faces.push([...s.dice]); const moves = s.die!; expect(moves).toBe(s.dice.reduce((sum, face) => sum + face, 0)); expect(s.dice).toHaveLength(vehicleId === null ? 1 : vehicleId === 'bicycle' ? 2 : 3); expect(s.pendingSteps).toBe(moves);
      expect(deserializeGame(serializeGame(s))).toEqual(s);
      while (s.phase === 'moving') s = dispatch(s, { type: 'step' });
      expect(s.marketTick).toBe(moves); expect(s.stocks.every(st => st.history.length === moves + 1)).toBe(true);
    }
    expect(faces[1][0]).toBe(faces[0][0]); expect(faces[2].slice(0, 2)).toEqual(faces[1]);
  });
  it('specified dice controls only the first die, while remaining vehicle dice still roll', () => {
    let s = createGame({ seed: 'loaded-car' }); s.players[0].vehicles = ['city-car']; s.players[0].cards = ['loadedDice']; s = dispatch(s, { type: 'equipVehicle', vehicleId: 'city-car' }); s = dispatch(s, { type: 'useCard', card: 'loadedDice', value: 6 }); s = dispatch(s, { type: 'roll' });
    expect(s.dice).toHaveLength(3); expect(s.dice[0]).toBe(6); expect(s.die).toBeGreaterThanOrEqual(8); expect(s.die).toBeLessThanOrEqual(18); expect(s.nextDice).toBeNull();
  });
  it('requires exact shop arrival and cash, charges once, and stores the vehicle without equipping mid-turn', () => {
    expect(() => dispatch(onTile(3), { type: 'buyVehicle', vehicleId: 'bicycle' })).toThrow();
    const moving = onTile(7); moving.phase = 'moving'; moving.pendingSteps = 1; expect(() => dispatch(moving, { type: 'buyVehicle', vehicleId: 'bicycle' })).toThrow();
    const poor = onTile(7); poor.players[0].cash = 0; poor.players[0].deposit = 50000; expect(() => dispatch(poor, { type: 'buyVehicle', vehicleId: 'bicycle' })).toThrow('現金不足');
    let s = onTile(7); s = dispatch(s, { type: 'buyVehicle', vehicleId: 'bicycle' }); expect(s.players[0].cash).toBe(9650); expect(s.players[0].deposit).toBe(2000); expect(s.players[0].vehicles).toEqual(['bicycle']); expect(s.players[0].vehicleId).toBeNull();
    expect(() => dispatch(s, { type: 'buyVehicle', vehicleId: 'bicycle' })).toThrow('已經擁有'); expect(() => dispatch(s, { type: 'buyVehicle', vehicleId: 'scooter' })).toThrow('本回合已使用');
    s.performedActions = []; expect(() => dispatch(s, { type: 'buyVehicle', vehicleId: 'bicycle' })).toThrow('已經擁有'); expect(() => dispatch(s, { type: 'buyVehicle', vehicleId: 'unknown' })).toThrow();
  });
  it('only the current owner can switch before rolling while free, including switching back to walking', () => {
    const s = createGame(); s.players[0].vehicles = ['bicycle', 'city-car'];
    expect(() => dispatch(s, { type: 'equipVehicle', vehicleId: 'scooter' })).toThrow('自己擁有'); expect(() => dispatch(s, { type: 'equipVehicle', vehicleId: 'bicycle', actorId: 'player-1' })).toThrow('不是你的回合');
    const equipped = dispatch(s, { type: 'equipVehicle', vehicleId: 'city-car' }); expect(getDiceCount(equipped.players[0])).toBe(3); expect(() => dispatch(equipped, { type: 'equipVehicle', vehicleId: 'city-car' })).toThrow(); expect(dispatch(equipped, { type: 'equipVehicle', vehicleId: null }).players[0].vehicleId).toBeNull();
    expect(() => dispatch(dispatch(equipped, { type: 'roll' }), { type: 'equipVehicle', vehicleId: null })).toThrow('擲骰前');
    const jailed = structuredClone(s); jailed.players[0].position = 12; jailed.players[0].jailTurns = 2; expect(() => dispatch(jailed, { type: 'equipVehicle', vehicleId: 'bicycle' })).toThrow();
    const afterMove = structuredClone(s); afterMove.phase = 'action'; expect(() => dispatch(afterMove, { type: 'equipVehicle', vehicleId: 'bicycle' })).toThrow();
  });
  it('values garages at half price and liquidates a mounted vehicle before property when cash runs out', () => {
    const s = createGame(); s.players[0].vehicles = ['city-car']; s.players[0].vehicleId = 'city-car'; expect(getNetWorth(s, s.players[0])).toBe(12900);
    s.players[0].cash = 0; s.players[0].deposit = 0; s.tiles[1].ownerId = 'player-1'; s.tiles[1].level = 3; s.tiles[2].ownerId = 'player-0'; const rent = getRent(s.tiles[1]); const moved = walkTo(s, 1);
    expect(moved.players[0].vehicles).toEqual([]); expect(moved.players[0].vehicleId).toBeNull(); expect(moved.players[0].cash).toBe(900 - rent); expect(moved.players[0].bankrupt).toBe(false); expect(moved.tiles[2].ownerId).toBe('player-0');
  });
  it('retains valid rolled dice in saves when arrival liquidates the active vehicle', () => {
    const s = createGame(); s.players[0].vehicles = ['city-car']; s.players[0].vehicleId = 'city-car'; s.players[0].cash = 0; s.players[0].deposit = 0; s.tiles[1].ownerId = 'player-1'; s.tiles[1].level = 3;
    s.phase = 'moving'; s.dice = [1, 1, 1]; s.die = 3; s.pendingSteps = 1; const moved = dispatch(s, { type: 'step' });
    expect(moved.players[0].vehicleId).toBeNull(); expect(moved.dice).toEqual([1, 1, 1]); expect(deserializeGame(serializeGame(moved))).toEqual(moved);
  });
  it('keeps owned and equipped transport through jail and resumes its dice after bail', () => {
    let s = createGame(); s.players[0].vehicles = ['tesla-model-y']; s.players[0].vehicleId = 'tesla-model-y'; s.players[0].position = 12; s.players[0].jailTurns = 2;
    s = dispatch(s, { type: 'bail' }); s = dispatch(s, { type: 'roll' }); expect(s.dice).toHaveLength(3); expect(s.players[0].vehicles).toEqual(['tesla-model-y']);
  });
  it('migrates v1 saves, including in-progress rolls, into an empty garage and one-die result', () => {
    const s = dispatch(createGame({ seed: 'legacy' }), { type: 'roll' });
    const { dice: _dice, ...old } = s; const legacy = { ...old, version: 1, players: s.players.map(({ vehicles: _vehicles, vehicleId: _vehicleId, ...p }) => p) };
    const migrated = deserializeGame(JSON.stringify(legacy)); expect(migrated).toEqual(s); expect(migrated.version).toBe(2); expect(migrated.dice).toEqual([s.die]);
  });
  it('rejects duplicate vehicles, unowned equipped models, forged dice counts, and mismatched movement totals', () => {
    const s = createGame();
    const malformed = [
      (x: GameState) => { x.players[0].vehicles = ['bicycle', 'bicycle']; },
      (x: GameState) => { x.players[0].vehicles = ['fake']; },
      (x: GameState) => { x.players[0].vehicleId = 'city-car'; },
      (x: GameState) => { x.dice = [6, 6, 6, 6]; x.die = 24; },
      (x: GameState) => { x.dice = [1, 1]; x.die = 3; },
      (x: GameState) => { x.dice = [6, 6]; x.die = 12; x.pendingSteps = 12; x.phase = 'moving'; },
    ];
    malformed.forEach(mutate => { const copy = structuredClone(s); mutate(copy); expect(() => deserializeGame(serializeGame(copy))).toThrow(); });
  });
  it('NPCs equip once then roll without a repeated-switch loop', () => {
    let s = createGame(); s.players[0].vehicles = ['bicycle', 'city-car', 'tesla-model-3'];
    const equip = getNpcAction(s)!; expect(equip.type).toBe('equipVehicle'); s = dispatch(s, equip); expect(getNpcAction(s)).toEqual({ type: 'roll' });
    s = dispatch(s, getNpcAction(s)!); expect(s.dice).toHaveLength(3);
  });
  it('completes 12 full games with mixed 1/2/3-dice transports and resumable saves', () => {
    for (let seed = 0; seed < 12; seed++) {
      let s = createGame({ seed: `mixed-${seed}` }); s.players[1].vehicles = ['bicycle']; s.players[2].vehicles = ['scooter']; s.players[3].vehicles = ['tesla-model-y']; let actions = 0;
      while (s.phase !== 'finished' && actions < 3000) { s = dispatch(s, getNpcAction(s)!); assertSolvent(s); if (actions % 37 === 0) expect(deserializeGame(serializeGame(s))).toEqual(s); actions++; }
      expect(s.phase).toBe('finished'); expect(actions).toBeLessThan(3000); expect(deserializeGame(serializeGame(s))).toEqual(s);
    }
  }, 20000);
});

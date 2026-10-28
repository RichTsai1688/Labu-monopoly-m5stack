import { it, expect } from "vitest";
import { createGame, dispatch, serializeGame, deserializeGame } from "./engine";
for (const maxRounds of [10, 20])
  it(`settles after every seat finishes round ${maxRounds}`, () => {
    let s = createGame({ seats: 4, maxRounds });
    s.round = maxRounds;
    s.phase = "action";
    s.players[2].cash += 10000;
    for (let i = 0; i < 3; i++) {
      s = dispatch(s, { type: "finishTurn" });
      expect(s.phase).toBe("roll");
      expect(s.round).toBe(maxRounds);
      s.phase = "action";
    }
    s = dispatch(s, { type: "finishTurn" });
    expect(s.phase).toBe("finished");
    expect(s.winner).toBe(s.players[2].id);
    expect(deserializeGame(serializeGame(s)).maxRounds).toBe(maxRounds);
  });

it('starts a new game with 20 rounds and 1,000 萬元 cash while preserving an existing save', () => {
  const fresh = createGame({ seats: 2 });
  expect(fresh.maxRounds).toBe(20);
  expect(fresh.players.map(player => [player.cash, player.deposit])).toEqual([[10000, 2000], [10000, 2000]]);
  fresh.maxRounds = 12;
  fresh.players[0].cash = 4000;
  const restored = deserializeGame(serializeGame(fresh));
  expect(restored.maxRounds).toBe(12);
  expect(restored.players[0].cash).toBe(4000);
});

it('unlimited games continue past old limits, pay dividends and change housing prices, and round-trip', () => {
  let s = createGame({ seats: 2, maxRounds: 0, seed: 'unlimited' });
  expect(s.log.at(-1)?.text).toContain('無限輪');
  s.round = 102; s.turn = 500; s.marketTick = 8000; s.currentPlayer = 1;
  s.phase = 'action'; s.players[0].holdings['stock-4'] = 10; s.players[0].costBasis['stock-4'] = 850;
  const deposit = s.players[0].deposit;
  s = dispatch(s, { type: 'finishTurn' });
  expect(s.round).toBe(103); expect(s.phase).toBe('roll');
  expect(s.propertyReport?.round).toBe(103);
  expect(s.players[0].deposit).toBeGreaterThan(deposit);
  expect(deserializeGame(serializeGame(s))).toEqual(s);
});

it('an unlimited game ends when only one player remains solvent', () => {
  let s = createGame({ seats: 2, maxRounds: 0 });
  s.players[1].bankrupt = true; s.phase = 'action';
  s = dispatch(s, { type: 'finishTurn' });
  expect(s.phase).toBe('finished'); expect(s.winner).toBe('player-0');
  expect(deserializeGame(serializeGame(s))).toEqual(s);
});

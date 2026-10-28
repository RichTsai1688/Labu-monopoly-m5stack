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

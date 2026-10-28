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

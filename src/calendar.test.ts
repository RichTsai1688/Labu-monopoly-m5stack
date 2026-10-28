import { describe, it, expect } from "vitest";
import { gameCalendar } from "./calendar";
import {
  createGame,
  dispatch,
  getNetWorth,
  serializeGame,
  deserializeGame,
} from "./engine";
function seasonEnd(round = 2, maxRounds = 20) {
  const s = createGame({ seats: 2, maxRounds });
  s.round = round;
  s.currentPlayer = 1;
  s.phase = "action";
  return s;
}
describe("shared calendar and dividends", () => {
  it("advances every two rounds and rolls over years", () => {
    expect([1, 3, 5, 7, 9].map((r) => gameCalendar(r).season)).toEqual([
      "春",
      "夏",
      "秋",
      "冬",
      "春",
    ]);
    expect(gameCalendar(9).year).toBe(2);
  });
  it("pays eligible holders, adjusts ex-dividend quote, preserves wealth and shares", () => {
    const s = seasonEnd();
    s.players[0].holdings["stock-0"] = 10;
    s.players[0].costBasis["stock-0"] = 300;
    const wealth = getNetWorth(s, s.players[0]),
      rng = s.rngState;
    const n = dispatch(s, { type: "finishTurn" });
    expect(n.round).toBe(3);
    expect(n.stocks[0].price).toBe(29);
    expect(n.players[0].deposit).toBe(2010);
    expect(n.players[0].dividendsReceived).toBe(10);
    expect(n.players[0].holdings["stock-0"]).toBe(10);
    expect(n.players[0].costBasis["stock-0"]).toBe(300);
    expect(getNetWorth(n, n.players[0])).toBe(wealth);
    expect(n.marketTick).toBe(0);
    expect(n.rngState).toBe(rng);
    expect(deserializeGame(serializeGame(n))).toEqual(n);
  });
  it("does not pay twice on reload or on a later buyer, and pays final-season dividend before ranking", () => {
    let s = seasonEnd(2, 2);
    s.players[0].holdings["stock-0"] = 5;
    s.players[0].costBasis["stock-0"] = 150;
    s = dispatch(s, { type: "finishTurn" });
    expect(s.phase).toBe("finished");
    expect(s.players[0].dividendsReceived).toBe(5);
    expect(deserializeGame(serializeGame(s)).players[0].deposit).toBe(2005);
    expect(() => dispatch(s, { type: "finishTurn" })).toThrow();
    const later = seasonEnd(3);
    later.players[0].holdings["stock-0"] = 5;
    later.players[0].costBasis["stock-0"] = 150;
    expect(
      dispatch(later, { type: "finishTurn" }).players[0].dividendsReceived,
    ).toBe(0);
  });
  it("uses company seasons and suspends payout at the floor without inventing wealth", () => {
    const s = seasonEnd(4);
    s.stocks[2].price = 5;
    s.stocks[2].history = [5];
    s.players[0].holdings["stock-2"] = 4;
    s.players[0].costBasis["stock-2"] = 20;
    const n = dispatch(s, { type: "finishTurn" });
    expect(n.stocks[2].price).toBe(5);
    expect(n.players[0].dividendsReceived).toBe(0);
    expect(n.stocks[3].price).toBe(62);
    expect(n.stocks[0].price).toBe(30);
  });
  it("preserves old saves holdings and costs and migrates only the missing dividend counter", () => {
    const s = createGame();
    delete s.players[0].dividendsReceived;
    s.players[0].holdings["stock-0"] = 3;
    s.players[0].costBasis["stock-0"] = 90;
    const n = deserializeGame(JSON.stringify(s));
    expect(n.players[0].dividendsReceived).toBe(0);
    expect(n.players[0].holdings).toEqual(s.players[0].holdings);
    expect(n.players[0].costBasis).toEqual(s.players[0].costBasis);
  });
});

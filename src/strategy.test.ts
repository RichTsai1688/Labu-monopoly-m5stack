import { describe, it, expect } from "vitest";
import {
  createGame,
  dispatch,
  deserializeGame,
  serializeGame,
  getRent,
  getUpgradeCost,
  ownsDistrict,
  getNpcAction,
} from "./engine";
describe("strategic city rules", () => {
  it("awards and removes district bonuses dynamically in actual rent transfers", () => {
    let s = createGame({ seats: 2, seed: "district" });
    const owner = s.players[1];
    const group = s.tiles.filter(
      (t) => t.type === "property" && t.district === 0,
    );
    group.forEach((t) => (t.ownerId = owner.id));
    const tile = group[0];
    expect(ownsDistrict(s, tile)).toBe(true);
    expect(getRent(tile, s)).toBe(Math.round(tile.price * 0.12 * 1.5));
    expect(getUpgradeCost(s, tile)).toBe(tile.upgradeCost * 0.8);
    s.players[0].position = tile.id - 1;
    s.phase = "moving";
    s.pendingSteps = 1;
    s.die = 1;
    s.dice = [1];
    const cash = s.players[0].cash;
    s = dispatch(s, { type: "step" });
    expect(s.players[0].cash).toBe(cash - getRent(tile, s));
    s.tiles[group[1].id].ownerId = null;
    expect(ownsDistrict(s, s.tiles[tile.id])).toBe(false);
    expect(getRent(s.tiles[tile.id], s)).toBe(getRent(tile));
  });
  it("allows one remote upgrade and no opponent, max-level, prison or moving bypass", () => {
    let s = createGame({ seats: 2 });
    s.phase = "action";
    s.players[0].cards = ["renovation", "renovation"];
    s.tiles[1].ownerId = s.players[0].id;
    const before = serializeGame(s);
    expect(() =>
      dispatch(s, { type: "useCard", card: "renovation", tileId: 2 }),
    ).toThrow();
    expect(serializeGame(s)).toBe(before);
    const next = dispatch(s, {
      type: "useCard",
      card: "renovation",
      tileId: 1,
    });
    expect(next.tiles[1].level).toBe(1);
    expect(next.players[0].cash).toBe(s.players[0].cash);
    expect(() =>
      dispatch(next, { type: "useCard", card: "renovation", tileId: 1 }),
    ).toThrow();
    s.players[0].jailTurns = 1;
    s.players[0].position = 12;
    expect(() =>
      dispatch(s, { type: "useCard", card: "renovation", tileId: 1 }),
    ).toThrow();
    s.players[0].jailTurns = 0;
    s.tiles[1].level = 3;
    expect(() =>
      dispatch(s, { type: "useCard", card: "renovation", tileId: 1 }),
    ).toThrow();
    s.phase = "moving";
    expect(() =>
      dispatch(s, { type: "useCard", card: "renovation", tileId: 1 }),
    ).toThrow();
  });
  it("claims goals once per player, keeps them across saves and migrates old saves", () => {
    let s = createGame({ seats: 2 });
    for (const stock of s.stocks.slice(0, 3))
      s.players[0].holdings[stock.id] = 5;
    expect(getNpcAction(s)).toEqual({ type: "claimGoal", goalId: "investor" });
    const next = dispatch(s, { type: "claimGoal", goalId: "investor" });
    expect(next.players[0].cash).toBe(s.players[0].cash + 350);
    expect(() =>
      dispatch(next, { type: "claimGoal", goalId: "investor" }),
    ).toThrow();
    expect(
      deserializeGame(serializeGame(next)).players[0].completedGoals,
    ).toEqual(["investor"]);
    expect(() =>
      dispatch(s, { type: "claimGoal", goalId: "builder" }),
    ).toThrow();
    const old = JSON.parse(serializeGame(s));
    old.players.forEach(
      (p: Record<string, unknown>) => delete p.completedGoals,
    );
    expect(
      deserializeGame(JSON.stringify(old)).players[0].completedGoals,
    ).toEqual([]);
    old.players[0].completedGoals = ["investor", "investor"];
    expect(() => deserializeGame(JSON.stringify(old))).toThrow();
  });
});

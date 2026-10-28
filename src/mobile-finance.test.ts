import {describe,it,expect} from 'vitest';
import {createGame,dispatch,serializeGame,deserializeGame} from './engine';
describe('remote finance and property market',()=>{
 it('allows other players to trade their own savings without changing turn or movement',()=>{
  let s=createGame({seats:2});s=dispatch(s,{type:'roll'});const before=s.players[0].deposit;
  const n=dispatch(s,{type:'buyStock',actorId:'player-1',stockId:'stock-0',quantity:2,expectedPrice:30});
  expect(n.players[1].deposit).toBe(1940);expect(n.players[0].deposit).toBe(before);expect(n.pendingSteps).toBe(s.pendingSteps);expect(n.currentPlayer).toBe(s.currentPlayer);
  expect(()=>dispatch(s,{type:'buyStock',actorId:'player-1',stockId:'stock-0',quantity:2,expectedPrice:31})).toThrow('股價已更新');
 });
 it('has three successful mobile transfers per player and recharges on bank arrival',()=>{
  let s=createGame({seats:2});for(let i=0;i<3;i++)s=dispatch(s,{type:'deposit',amount:10});
  expect(s.players[0].mobileBankUses).toBe(3);expect(()=>dispatch(s,{type:'withdraw',amount:10})).toThrow('3 次已用完');
  expect(dispatch(s,{type:'withdraw',actorId:'player-1',amount:10}).players[1].mobileBankUses).toBe(1);
  s.players[0].position=3;s.phase='action';s=dispatch(s,{type:'withdraw',amount:10});expect(s.players[0].mobileBankUses).toBe(3);
  s.players[0].position=2;s.phase='moving';s.die=1;s.dice=[1];s.pendingSteps=1;s=dispatch(s,{type:'step'});expect(s.players[0].mobileBankUses).toBe(0);
  expect(deserializeGame(serializeGame(s))).toEqual(s);
 });
 it('rejects a failed transfer without consuming a use',()=>{const s=createGame();expect(()=>dispatch(s,{type:'withdraw',amount:999999})).toThrow();expect(s.players[0].mobileBankUses??0).toBe(0);});
 it('reprices different districts at season end, survives save and does not consume dice RNG',()=>{
  let up=false,down=false;for(let seed=0;seed<10;seed++){let s=createGame({seed,seats:2});s.round=2;s.currentPlayer=1;s.phase='action';const n=dispatch(s,{type:'finishTurn'});expect(n.rngState).toBe(s.rngState);expect(n.propertyReport?.changes).toHaveLength(6);expect(n.tiles[1].price).not.toBe(s.tiles[1].price);expect(deserializeGame(serializeGame(n))).toEqual(n);up ||= n.propertyReport!.changes.some(c=>c.percent>0);down ||= n.propertyReport!.changes.some(c=>c.percent<0);}expect(up&&down).toBe(true);
 });
});

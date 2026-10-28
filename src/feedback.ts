import type { GameSound } from './audio';
import type { GameState } from './game-types';
const money = (value:number) => `${(value / 10).toLocaleString('zh-TW', {maximumFractionDigits:1})} 萬元`;
let scope = '';
let previous = new Map<string, {cash:number;deposit:number}>();
const active = new Set<Animation>();
let popupKey = '';
let levels: number[] = [];
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function play(el: HTMLElement, frames: Keyframe[], duration: number, remove = false) {
  const animation = el.animate(frames, {duration, easing:'cubic-bezier(.2,.75,.3,1)', fill:'none'});
  active.add(animation);
  const done = () => { active.delete(animation); if (remove) el.remove(); };
  animation.onfinish = done; animation.oncancel = done;
}
export function popupFeedback(el: HTMLElement, key: string, kind = '') {
  if (popupKey === key) return;
  popupKey = key;
  if (reduce()) return;
  // Animate the inner content, preserving the outer card's centered positioning.
  play(el, [
    {opacity:.3,transform:'translateY(10px) scale(.94) rotate(-1deg)'},
    {opacity:1,transform:'translateY(-3px) scale(1.015) rotate(.7deg)',offset:.48},
    {transform:'rotate(-.45deg)',offset:.7},{transform:'none'},
  ], 520);
  if (/房屋|獎|股利|購入|購買/.test(kind)) {
    const art = el.querySelector<HTMLElement>('.arrival-art');
    if (art) play(art,[{filter:'brightness(1)'},{filter:'brightness(1.25)',offset:.4},{filter:'brightness(1)'}],700);
  }
}
export function renderMoneyFeedback(state: GameState, sound?: (kind:GameSound)=>void, selfId?: string) {
  const newScope = `${state.seed}:${state.players.map(p=>p.id+p.name).join('|')}`;
  const upgraded = scope === newScope && state.tiles.some((tile,i)=>tile.level > (levels[i] ?? tile.level));
  levels = state.tiles.map(t=>t.level);
  const changes: {index:number;name:string;amount:number;account:string}[] = [];
  state.players.forEach((p,index)=>{
    const old = scope === newScope ? previous.get(p.id) : undefined;
    if (old) for (const account of ['cash','deposit'] as const) {
      const amount=p[account]-old[account];
      if (amount) changes.push({index,name:p.name,amount,account:account==='cash'?'現金':'存款'});
    }
  });
  scope = newScope; previous = new Map(state.players.map(p=>[p.id,{cash:p.cash,deposit:p.deposit}]));
  if (!changes.length) { if (upgraded) sound?.('upgrade'); return; }
  // Cap transient DOM and cancel old effects on rapid transactions.
  document.querySelectorAll('.money-feedback').forEach(e=>{ e.getAnimations({subtree:true}).forEach(a=>a.cancel()); e.remove(); });
  const layer=document.createElement('div');layer.className='money-feedback';layer.setAttribute('role','status');
  const reason=[...state.log].reverse().find(l=>/萬元/.test(l.text))?.text || '交易已完成';
  const focusIndex = state.players.findIndex(p=>p.id === (selfId || state.players[state.currentPlayer].id));
  const focused = changes.filter(c=>c.index === focusIndex);
  const relevant = focused.length ? focused : changes.filter(c=>c.index === state.currentPlayer);
  const net = relevant.reduce((sum,c)=>sum+c.amount,0);
  sound?.(upgraded || /升為|升級/.test(reason) ? 'upgrade' : net>0 ? 'income' : net<0 ? 'expense' : 'bank');
  const title=document.createElement('p');title.className='money-flow-label';title.textContent=reason;layer.append(title);
  for(const change of changes.slice(0,8)) {
    const chip=document.createElement('div');chip.className=`money-change ${change.amount>0?'money-in':'money-out'}`;
    chip.textContent=`${change.amount>0?'↙ 收入':'↗ 支出'} ${change.name} · ${change.account} ${change.amount>0?'+':'−'}${money(Math.abs(change.amount))}`;
    layer.append(chip);
    const card=document.querySelector<HTMLElement>(`[data-player="${change.index}"]`);
    if(card&&!reduce())play(card,[{filter:'brightness(1)'},{filter:change.amount>0?'brightness(1.2)':'brightness(.88)',offset:.3},{filter:'brightness(1)'}],600);
  }
  if(!reduce())for(let i=0;i<6;i++) {
    const coin=document.createElement('span');coin.className='feedback-coin';coin.textContent='🪙';coin.setAttribute('aria-hidden','true');layer.append(coin);
    play(coin,[{opacity:0,transform:'translate(0,0) scale(.6)'},{opacity:1,offset:.2},{opacity:0,transform:`translate(${(i-2.5)*35}px,${-45-Math.abs(i-2.5)*12}px) rotate(${i*75}deg)`}],1000,true);
  }
  (document.querySelector('dialog[open]') || document.body).append(layer);
  play(layer,reduce()?[{opacity:1},{opacity:1,offset:.85},{opacity:0}]:[{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'none',offset:.12},{opacity:1,offset:.82},{opacity:0,transform:'translateY(-8px)'}],2800,true);
}
export function disposeFeedback() {
  for(const animation of active)animation.cancel();active.clear();
  document.querySelectorAll('.money-feedback').forEach(e=>{ e.getAnimations({subtree:true}).forEach(a=>a.cancel()); e.remove(); });previous.clear();scope='';popupKey='';levels=[];
}

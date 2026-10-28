import itemAtlas from "./assets/art/items-atlas.webp";
// One optimized atlas, shared by all collectible cards and confirmation screens.
const order = ['loadedDice','rentShield','jailFree','renovation','wanted','steal','roadblock','trap','shutdown','swap','bodyguard'];
export function cardArt(id: string): string {
 const index = order.indexOf(id), cell = index < 0 ? 11 : index;
 return `<span class="card-art" role="img" aria-label="道具插圖" style="background-image:url('${itemAtlas}');background-size:400% 300%;background-position:${cell % 4 * 100/3}% ${Math.floor(cell/4)*50}%;border-radius:14px"></span>`;
}
export const cardSummaries: Record<string,string> = {loadedDice:'第一顆骰子，由你決定',rentShield:'自動擋下一次租金',jailFree:'重獲自由，繼續冒險',renovation:'自己的房子免費升級',wanted:'讓對手暫停一次移動',steal:'偷走對手部分現金',roadblock:'讓路過的對手停下',trap:'留個小驚喜給對手',shutdown:'暫停對手地產收租',swap:'和另一位玩家交換位置',bodyguard:'自動抵擋一次攻擊'};

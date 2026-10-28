/** Money is stored as safe integers in tenths of 萬元: 4000 means 400 萬元. */
export type Theme = 'candy' | 'space' | 'forest' | 'harbor';
export type Card = 'loadedDice' | 'rentShield' | 'jailFree' | 'renovation' | 'wanted' | 'steal' | 'roadblock' | 'trap' | 'shutdown' | 'swap' | 'bodyguard';
export type TileType = 'start' | 'property' | 'bank' | 'prison' | 'police' | 'station' | 'shop' | 'event' | 'park' | 'tax' | 'amusement' | 'auction' | 'construction';
export interface Tile { id: number; type: TileType; name: string; district: number; price: number; upgradeCost: number; ownerId: string | null; level: number; closedUntilTurn?: number; closedById?: string; }
export interface Vehicle { id: string; name: string; price: number; diceCount: 2 | 3; kind: 'bike' | 'scooter' | 'car'; color: string; }
export interface Player { mobileBankUses?: number; id: string; name: string; isNpc: boolean; theme: Theme; color: string; position: number; cash: number; deposit: number; /** Holdings count lots of 1000 shares; one price unit equals 1 yuan/share. */ holdings: Record<string, number>; costBasis: Record<string, number>; realizedProfit: number; dividendsReceived?: number; personality: 'cautious' | 'balanced' | 'bold'; cards: Card[]; completedGoals: string[]; vehicles: string[]; vehicleId: string | null; jailTurns: number; wantedSkip?: boolean; wantedImmuneUntilRound?: number; bankrupt: boolean; }
export interface Stock { id: string; name: string; price: number; previousPrice: number; history: number[]; volatility: number; }
export interface GameLog { id: number; round: number; text: string; }
export interface GameState {
  version: 2; seed: string; rngState: number; players: Player[]; currentPlayer: number;
  phase: 'roll' | 'moving' | 'action' | 'finished'; turn: number; round: number; maxRounds: number;
  marketTick: number; stocks: Stock[]; tiles: Tile[]; log: GameLog[]; nextLogId: number;
  /** die is the total movement; dice contains each individual rolled face. */
  winner: string | null; die: number | null; dice: number[]; pendingSteps: number; nextDice: number | null;
  performedActions: string[]; auctionTileId: number | null; arrivalMessage: string;
  hazards?: { tileId: number; ownerId: string; kind: 'roadblock' | 'trap'; expiresTurn: number }[];
  propertyReport?: { round: number; changes: { district: number; percent: number }[] };
  marketTrend: number; trendSteps: number;
}
export interface PlayerConfig { name: string; isNpc?: boolean; theme?: Theme; }
export interface GameOptions { seed?: string | number; seats?: 2 | 3 | 4; humanNames?: string[]; maxRounds?: number; players?: PlayerConfig[]; }
export type GameAction = ({ type: 'roll' | 'step' | 'buy' | 'finishTurn' | 'station' | 'amusement' | 'bail' }
  | { type: 'claimGoal'; goalId: string }
  | { type: 'upgrade'; tileId?: number }
  | { type: 'deposit' | 'withdraw'; amount: number }
  | { type: 'buyStock' | 'sellStock'; expectedPrice?: number; stockId: string; quantity: number }
  | { type: 'shop'; card: Card }
  | { type: 'buyVehicle'; vehicleId: string }
  | { type: 'equipVehicle'; vehicleId: string | null }
  | { type: 'useCard'; card: Card; value?: number; tileId?: number; targetId?: string }
  | { type: 'auction'; bid: number }) & { actorId?: string };

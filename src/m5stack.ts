export class ShakeLineDecoder {
  private remainder = "";

  push(chunk: string): number {
    const lines = (this.remainder + chunk).split("\n");
    this.remainder = lines.pop() ?? "";
    if (this.remainder.length > 64) this.remainder = this.remainder.slice(-64);
    return lines.filter((line) => line.trim().toUpperCase() === "SHAKE").length;
  }

  reset(): void {
    this.remainder = "";
  }
}

export class ShakeRollGate {
  private acceptedTurn: string | null = null;

  tryRoll(turn: string, eligible: boolean, roll: () => void): boolean {
    if (!eligible || this.acceptedTurn === turn) return false;
    this.acceptedTurn = turn;
    roll();
    return true;
  }

  reset(): void {
    this.acceptedTurn = null;
  }
}

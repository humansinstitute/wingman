const DEFAULT_BASE = parseInt(process.env.AGENTAPI_PORT_BASE || '3284', 10);
const DEFAULT_POOL = parseInt(process.env.AGENTAPI_PORT_POOL || '16', 10);

class PortAllocator {
  constructor() {
    this.base = Number.isFinite(DEFAULT_BASE) ? DEFAULT_BASE : 3284;
    this.poolSize = Number.isFinite(DEFAULT_POOL) ? DEFAULT_POOL : 16;
    this.reserved = new Set();
  }

  /**
   * Reserve a port for an AgentAPI process.
   * @param {number|undefined} preferred Specific port requested by caller.
   * @returns {{ port: number, release: () => void }}
   */
  acquire(preferred) {
    if (preferred !== undefined && preferred !== null) {
      const desired = Number(preferred);
      if (!Number.isInteger(desired) || desired <= 0) {
        throw new Error(`Invalid preferred port: ${preferred}`);
      }
      if (this.reserved.has(desired)) {
        throw new Error(`Port ${desired} is already reserved`);
      }
      this.reserved.add(desired);
      return { port: desired, release: () => this.release(desired) };
    }

    for (let candidate = this.base; candidate < this.base + this.poolSize; candidate++) {
      if (!this.reserved.has(candidate)) {
        this.reserved.add(candidate);
        return { port: candidate, release: () => this.release(candidate) };
      }
    }

    throw new Error('No available AgentAPI ports in configured pool');
  }

  release(port) {
    if (port === undefined || port === null) return;
    this.reserved.delete(Number(port));
  }
}

module.exports = new PortAllocator();

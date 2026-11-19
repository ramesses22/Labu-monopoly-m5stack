export type M5StackEvent = 'SHAKE' | 'NEXT' | 'SELECT';
export type M5StackCommand = 'CONNECT' | 'DISCONNECT';
export type SerialEventListener = (event: M5StackEvent) => void;
export type SerialConnectionListener = (connected: boolean) => void;

interface SerialReader {
  read(): Promise<{ value?: Uint8Array; done: boolean }>;
  cancel(): Promise<void>;
  releaseLock(): void;
}
interface SerialPort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}
interface WebSerial {
  requestPort(): Promise<SerialPort>;
}

const SHAKE_COOLDOWN_MS = 750;
const MAX_LINE_LENGTH = 64;

export class ShakeEventGate {
  private lastShakeAt = Number.NEGATIVE_INFINITY;

  accept(now: number): boolean {
    if (now - this.lastShakeAt < SHAKE_COOLDOWN_MS) return false;
    this.lastShakeAt = now;
    return true;
  }

  reset(): void {
    this.lastShakeAt = Number.NEGATIVE_INFINITY;
  }
}

export function supportsWebSerial(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function isShakeMessage(line: string): boolean {
  return line.trim().toUpperCase() === 'SHAKE';
}

export function parseM5StackEvent(line: string): M5StackEvent | null {
  const command = line.trim().toUpperCase();
  return command === 'SHAKE' || command === 'NEXT' || command === 'SELECT' ? command : null;
}

export class M5StackSerial {
  connected = false;
  private port: SerialPort | null = null;
  private reader: SerialReader | null = null;
  private readTask: Promise<void> | null = null;
  private generation = 0;
  private readonly shakeGate = new ShakeEventGate();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly onEvent: SerialEventListener,
    private readonly onConnectionChange: SerialConnectionListener = () => {},
    private readonly now: () => number = () => performance.now(),
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    if (!supportsWebSerial()) throw new Error('此瀏覽器不支援 Web Serial，請使用支援的桌面版 Chrome 或 Edge。');
    const serial = (navigator as Navigator & { serial: WebSerial }).serial;
    const port = await serial.requestPort();
    await port.open({ baudRate: 115200 });
    if (!port.readable) {
      await port.close();
      throw new Error('無法讀取 M5Stack 序列資料，請重新連接裝置。');
    }
    this.port = port;
    this.connected = true;
    this.shakeGate.reset();
    const generation = ++this.generation;
    this.onConnectionChange(true);
    this.readTask = this.read(port, generation);
    try {
      await this.sendCommand('CONNECT');
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  sendCommand(command: M5StackCommand): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const port = this.port;
      if (!this.connected || !port) throw new Error('M5Stack 尚未連線');
      if (!port.writable) throw new Error('M5Stack 序列埠不支援傳送資料');
      const writer = port.writable.getWriter();
      let failed = false;
      let failure: unknown;
      try {
        await writer.write(new TextEncoder().encode(`${command}\n`));
      } catch (error) {
        failed = true;
        failure = error;
      } finally {
        writer.releaseLock();
      }
      if (failed) throw failure;
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    if (port && this.connected) {
      try { await this.sendCommand('DISCONNECT'); } catch { /* Release the port even if the device was unplugged. */ }
    }
    this.generation++;
    this.port = null;
    const reader = this.reader;
    this.reader = null;
    if (reader) {
      try { await reader.cancel(); } catch { /* The device may already be disconnected. */ }
    }
    if (port) {
      try { await port.close(); } catch { /* The browser may have closed the port already. */ }
    }
    this.setConnected(false);
  }

  private async read(port: SerialPort, generation: number): Promise<void> {
    let reader: SerialReader | null = null;
    let line = '';
    try {
      reader = port.readable!.getReader() as unknown as SerialReader;
      this.reader = reader;
      while (generation === this.generation) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const byte of value ?? []) {
          if (byte === 10 || byte === 13) {
            if (line) {
              const event = parseM5StackEvent(line);
              if (event === 'SHAKE') this.receiveShake();
              else if (event) this.onEvent(event);
            }
            line = '';
          } else if (line.length < MAX_LINE_LENGTH) {
            line += String.fromCharCode(byte);
          } else {
            line = '';
          }
        }
      }
    } catch {
      // Disconnects and browser read errors both return the game to manual controls.
    } finally {
      if (reader) {
        try { reader.releaseLock(); } catch { /* The stream may already be unlocked. */ }
      }
      if (this.reader === reader) this.reader = null;
      if (generation === this.generation && this.port === port) {
        this.port = null;
        try { await port.close(); } catch { /* Already closed by the browser. */ }
        this.setConnected(false);
      }
    }
  }

  private receiveShake(): void {
    if (this.shakeGate.accept(this.now())) this.onEvent('SHAKE');
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    this.onConnectionChange(connected);
  }
}

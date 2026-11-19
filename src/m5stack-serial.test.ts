import { describe, expect, it } from 'vitest';
import { isShakeMessage, parseM5StackEvent, ShakeEventGate } from './m5stack-serial';

describe('M5Stack serial shake protocol', () => {
  it('accepts only the SHAKE event line, ignoring case and whitespace', () => {
    expect(isShakeMessage('SHAKE\r')).toBe(true);
    expect(isShakeMessage(' shake ')).toBe(true);
    expect(isShakeMessage('ACCEL,0.1,0.2,0.3')).toBe(false);
    expect(isShakeMessage('SHAKE AGAIN')).toBe(false);
    expect(isShakeMessage('')).toBe(false);
    expect(parseM5StackEvent(' next\r')).toBe('NEXT');
    expect(parseM5StackEvent('SELECT')).toBe('SELECT');
    expect(parseM5StackEvent('CONNECT')).toBeNull();
  });

  it('debounces repeated shake events but accepts a later shake', () => {
    const gate = new ShakeEventGate();
    expect(gate.accept(1000)).toBe(true);
    expect(gate.accept(1200)).toBe(false);
    expect(gate.accept(1750)).toBe(true);
    gate.reset();
    expect(gate.accept(1751)).toBe(true);
  });
});

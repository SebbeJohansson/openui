import { describe, expect, it, vi } from 'vitest';
import { TypedEmitter } from './eventEmitter';

type Events = { ping: { n: number }; pong: string };

describe('TypedEmitter', () => {
  it('delivers a payload to every listener of that event only', () => {
    const emitter = new TypedEmitter<Events>();
    const a = vi.fn();
    const b = vi.fn();
    const other = vi.fn();
    emitter.on('ping', a);
    emitter.on('ping', b);
    emitter.on('pong', other);

    emitter.emit('ping', { n: 1 });

    expect(a).toHaveBeenCalledWith({ n: 1 });
    expect(b).toHaveBeenCalledWith({ n: 1 });
    expect(other).not.toHaveBeenCalled();
  });

  it('emitting an event with no listeners is a no-op', () => {
    const emitter = new TypedEmitter<Events>();
    expect(() => emitter.emit('pong', 'x')).not.toThrow();
  });

  it('the returned disposer removes only that listener', () => {
    const emitter = new TypedEmitter<Events>();
    const a = vi.fn();
    const b = vi.fn();
    const off = emitter.on('ping', a);
    emitter.on('ping', b);

    off();
    emitter.emit('ping', { n: 1 });

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('is safe to dispose the same listener twice', () => {
    const emitter = new TypedEmitter<Events>();
    const off = emitter.on('ping', vi.fn());
    off();
    expect(() => off()).not.toThrow();
  });

  it('registering the same function twice still calls it once (set semantics)', () => {
    const emitter = new TypedEmitter<Events>();
    const listener = vi.fn();
    emitter.on('ping', listener);
    emitter.on('ping', listener);
    emitter.emit('ping', { n: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('dispose() drops every listener', () => {
    const emitter = new TypedEmitter<Events>();
    const listener = vi.fn();
    emitter.on('ping', listener);
    emitter.dispose();
    emitter.emit('ping', { n: 1 });
    expect(listener).not.toHaveBeenCalled();
  });
});

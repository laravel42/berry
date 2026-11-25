declare module 'bun:test' {
  export function describe(label: string, fn: () => void): void;
  export function test(label: string, fn: () => void | Promise<void>): void;
  export interface Matchers<T> {
    toBe(expected: T): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toHaveLength(expected: number): void;
    toContain(expected: unknown): void;
    toMatch(expected: RegExp | string): void;
    toThrow(expected?: string | RegExp | (new (...args: never[]) => Error)): void;
    rejects: Matchers<unknown>;
    not: Matchers<T>;
  }
  export function expect<T>(actual: T): Matchers<T>;
}

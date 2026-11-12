/**
 * Structural equality for plain data: what a refetch hands back for a record
 * that did not change. Keeping the old object when the new one is the same
 * lets stores skip a notification and memoized rows skip a render.
 *
 * Primitives compare with `Object.is`, arrays element by element, and plain
 * objects (prototype `Object.prototype` or `null`) key by key, recursively.
 * Anything else — functions, icon components, class instances, dates — is
 * compared by reference, so a value that is not plain data is never assumed
 * equal to a copy of it.
 */
export function isSameValue(a: unknown, b: unknown): boolean {
   if (Object.is(a, b)) return true;
   if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
      return false;
   }

   if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let index = 0; index < a.length; index++) {
         if (!isSameValue(a[index], b[index])) return false;
      }
      return true;
   }

   if (!isPlainObject(a) || !isPlainObject(b)) return false;
   const keys = Object.keys(a);
   if (keys.length !== Object.keys(b).length) return false;
   for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!isSameValue(a[key], b[key])) return false;
   }
   return true;
}

function isPlainObject(value: object): value is Record<string, unknown> {
   const prototype: unknown = Object.getPrototypeOf(value);
   return prototype === Object.prototype || prototype === null;
}

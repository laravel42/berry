/**
 * Development builds of React's server-component client call
 * `performance.measure` when a render is rejected or aborted (`redirect()`,
 * `notFound()`). The end time can be negative, and the browser then throws
 * `cannot have a negative time stamp`, which Next shows as a runtime error.
 *
 * This file runs before hydration. An inline script in the root layout does
 * not: React 19 refuses to execute a script tag rendered from a component.
 * Production builds do not take this path.
 */
if (process.env.NODE_ENV === 'development') {
   const measure = performance.measure.bind(performance);
   performance.measure = function (name, startOrOptions, endMark) {
      if (!startOrOptions || typeof startOrOptions !== 'object') {
         return measure(name, startOrOptions, endMark);
      }
      let start = startOrOptions.start;
      let end = startOrOptions.end;
      if (typeof start === 'number' && start < 0) start = 0;
      if (typeof end === 'number' && end < 0) end = 0;
      if (typeof start === 'number' && typeof end === 'number' && end < start) end = start;
      if (start === startOrOptions.start && end === startOrOptions.end) {
         return measure(name, startOrOptions);
      }
      return measure(name, { ...startOrOptions, start, end });
   } as Performance['measure'];
}

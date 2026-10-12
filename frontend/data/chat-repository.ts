/** `owner/name`, the same shape a run's repository checkout accepts. */
const REPOSITORY_NAME = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function isChatRepository(value: unknown): value is string {
   return typeof value === 'string' && REPOSITORY_NAME.test(value);
}

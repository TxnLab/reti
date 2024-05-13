import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Uses clsx and tailwind-merge to construct className strings conditionally.
 * @param {ClassValue[]} inputs - Any number of arguments, can be Object, Array, Boolean, or String
 * @returns {string} The combined class names, merged without style conflicts
 * @see {@link https://github.com/lukeed/clsx#usage}
 * @see {@link https://github.com/dcastil/tailwind-merge}
 * @example
 * ```jsx
 * <p className={cn('text-center', { 'text-blue-500': isBlue })}>
 *   Hello, world!
 * </p>
 * ```
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

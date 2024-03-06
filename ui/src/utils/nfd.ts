/**
 * @description Checks if name is a valid NFD root/segment
 * @param name string to validate
 * @param suffixOptional if true, '.algo' suffix is optional (default: false)
 * @returns true if valid
 */
export function isValidName(name: string, suffixOptional = false): boolean {
  if (suffixOptional) {
    return /^([a-z0-9]{1,27}\.){0,1}(?<basename>[a-z0-9]{1,27})(\.algo)?$/g.test(name)
  }
  return /^([a-z0-9]{1,27}\.){0,1}(?<basename>[a-z0-9]{1,27})\.algo$/g.test(name)
}

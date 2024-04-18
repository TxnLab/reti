import { Nfd } from '@/interfaces/nfd'
import { getNfdAppFromViteEnvironment } from '@/utils/network/getNfdConfig'

/**
 * @description Checks if name is a valid NFD root/segment
 * @param {string} name NFD name to validate
 * @param {boolean} suffixOptional if true, '.algo' suffix is optional (default: false)
 * @returns {boolean} true if valid
 */
export function isValidName(name: string, suffixOptional = false): boolean {
  if (suffixOptional) {
    return /^([a-z0-9]{1,27}\.){0,1}(?<basename>[a-z0-9]{1,27})(\.algo)?$/g.test(name)
  }
  return /^([a-z0-9]{1,27}\.){0,1}(?<basename>[a-z0-9]{1,27})\.algo$/g.test(name)
}

/**
 * @description Checks if name is a valid NFD root
 * @param {string} name NFD name to validate
 * @param {boolean} suffixOptional if true, '.algo' suffix is optional (default: false)
 * @returns {boolean} true if valid
 */
export const isValidRoot = (name: string, suffixOptional = false): boolean => {
  if (suffixOptional) {
    return /^[a-z0-9]{1,27}(\.algo)?$/g.test(name)
  }
  return /^[a-z0-9]{1,27}\.algo$/g.test(name)
}

/**
 * @description Checks if name is a valid NFD segment
 * @param {string} name NFD name to validate
 * @param {boolean} suffixOptional if true, '.algo' suffix is optional (default: false)
 * @returns {boolean} true if valid
 */
export const isValidSegment = (name: string, suffixOptional = false): boolean => {
  if (suffixOptional) {
    return /^[a-z0-9]{1,27}\.(?<basename>[a-z0-9]{1,27})(\.algo)?$/g.test(name)
  }
  return /^[a-z0-9]{1,27}\.(?<basename>[a-z0-9]{1,27})\.algo?$/g.test(name)
}

/**
 * @description Trims the '.algo' suffix from the provided NFD, if it exists
 * @param {string} str NFD name to trim
 * @returns {string} NFD name with suffix removed
 */
export const trimExtension = (str: string): string => {
  return str.replace(/\.algo$/gi, '')
}

/**
 * @description Trims the segment prefix from the provided NFD, if it exists
 * @param {string} str NFD name to trim
 * @returns {string} NFD name with prefix removed, or original string if invalid
 */
export const trimSegment = (str: string): string => {
  if (!isValidName(str)) {
    return str
  }
  return str.match(/^[a-z0-9]{1,27}\.algo$/gi) ? str : `${str.split('.')[1]}.algo`
}

export function getNfdProfileUrl(name: string): string {
  const baseUrl = getNfdAppFromViteEnvironment()
  return `${baseUrl}/name/${name}`
}

export const getNfdAvatarUrl = (nfd: Nfd): string => {
  const baseUrl = getNfdAppFromViteEnvironment()
  const url = nfd?.properties?.userDefined?.avatar || nfd?.properties?.verified?.avatar

  const isAvailable = nfd.state === 'available'
  const isForSale = nfd.state === 'forSale'
  const isReserved = nfd.state === 'reserved'
  const isCurated = nfd.category === 'curated'

  if (!url && isCurated) {
    return `${baseUrl}/img/nfd-image-placeholder_gold.jpg`
  }

  const showAvailablePlaceholder = isAvailable || isForSale || isReserved

  if (!url && showAvailablePlaceholder) {
    return `${baseUrl}/img/nfd-image-placeholder_gray.jpg`
  }

  if (!url) {
    return `${baseUrl}/img/nfd-image-placeholder.jpg`
  }

  return url
}

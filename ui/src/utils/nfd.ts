import { Nfd } from '@/interfaces/nfd'
import { getNfdAppFromViteEnvironment } from '@/utils/network/getNfdConfig'

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

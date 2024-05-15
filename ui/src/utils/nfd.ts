import algosdk from 'algosdk'
import { Nfd } from '@/interfaces/nfd'
import { getNfdAppFromViteEnvironment } from '@/utils/network/getNfdConfig'

/**
 * Checks if name is a valid NFD name
 * @param {string} name - The NFD name to validate
 * @param {boolean} suffixOptional - Whether the '.algo' suffix is optional (default: false)
 * @returns {boolean} True if valid
 * @example
 * isValidName('example.algo') // true
 * isValidName('example', true) // true
 * isValidName('invalid_name.algo') // false
 */
export function isValidName(name: string, suffixOptional: boolean = false): boolean {
  if (suffixOptional) {
    return /^([a-z0-9]{1,27}\.){0,1}(?<basename>[a-z0-9]{1,27})(\.algo)?$/g.test(name)
  }
  return /^([a-z0-9]{1,27}\.){0,1}(?<basename>[a-z0-9]{1,27})\.algo$/g.test(name)
}

/**
 * Checks if name is a valid NFD root
 * @param {string} name - The NFD root to validate
 * @param {boolean} suffixOptional - Whether the '.algo' suffix is optional (default: false)
 * @returns {boolean} True if valid
 * @example
 * isValidRoot('root.algo') // true
 * isValidRoot('root', true) // true
 * isValidRoot('invalid_root') // false
 */
export const isValidRoot = (name: string, suffixOptional: boolean = false): boolean => {
  if (suffixOptional) {
    return /^[a-z0-9]{1,27}(\.algo)?$/g.test(name)
  }
  return /^[a-z0-9]{1,27}\.algo$/g.test(name)
}

/**
 * Checks if name is a valid NFD segment
 * @param {string} name - The NFD segment to validate
 * @param {boolean} suffixOptional - Whether the '.algo' suffix is optional (default: false)
 * @returns {boolean} True if valid
 * @example
 * isValidSegment('segment.root.algo') // true
 * isValidSegment('segment.root', true) // true
 * isValidSegment('invalid_segment') // false
 */
export const isValidSegment = (name: string, suffixOptional: boolean = false): boolean => {
  if (suffixOptional) {
    return /^[a-z0-9]{1,27}\.(?<basename>[a-z0-9]{1,27})(\.algo)?$/g.test(name)
  }
  return /^[a-z0-9]{1,27}\.(?<basename>[a-z0-9]{1,27})\.algo?$/g.test(name)
}

/**
 * Trims the '.algo' suffix from the provided name
 * @param {string} str - The NFD name to trim
 * @returns {string} NFD name with suffix removed
 * @example
 * trimExtension('example.algo') // 'example'
 * trimExtension('root') // 'root'
 */
export const trimExtension = (str: string): string => {
  return str.replace(/\.algo$/gi, '')
}

/**
 * Trims the segment prefix from the provided name
 * @param {string} str - The NFD name to trim
 * @returns {string} NFD name with segment prefix removed
 * @example
 * trimSegment('segment.root.algo') // 'root.algo'
 * trimSegment('root.algo') // 'root.algo'
 * trimSegment('invalid_segment') // 'invalid_segment'
 */
export const trimSegment = (str: string): string => {
  if (!isValidName(str)) {
    return str
  }
  return str.match(/^[a-z0-9]{1,27}\.algo$/gi) ? str : `${str.split('.')[1]}.algo`
}

/**
 * Generates the NFD profile URL for the provided name.
 * @param {string} name - The NFD name to generate the URL for
 * @returns {string} The NFD profile URL
 * @example
 * getNfdProfileUrl('example.algo') // 'https://nfd-app.mock/name/example.algo'
 */
export function getNfdProfileUrl(name: string): string {
  const baseUrl = getNfdAppFromViteEnvironment()
  return `${baseUrl}/name/${name}`
}

/**
 * Generates the NFD avatar URL for the provided NFD.
 * The base URL must be set as VITE_NFD_APP_URL in the Vite environment.
 * @param {Nfd} nfd - The NFD to generate the URL for
 * @returns {string} The NFD avatar URL
 * @example
 * getNfdAvatarUrl(nfd) // 'https://app.nf.domains/img/nfd-image-placeholder.jpg'
 */
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

/**
 * Generates the SHA-256 hash of the NFD registry box name for the provided NFD.
 * This can be used to define foreign box references for NFD registry app calls.
 * @see {@link https://api-docs.nf.domains/reference/integrators-guide/linking-an-application-to-an-nfd}
 * @param {string} nfdName - The NFD name to generate the registry box name for
 * @returns {Uint8Array} The SHA-256 hash of the NFD registry box name, in bytes
 */
export async function getRegistryBoxNameForNFD(nfdName: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(`name/${nfdName}`)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hash)
}

/**
 * Generates the SHA-256 hash of the NFD registry box name for the provided Algorand address.
 * This can be used to define foreign box references for NFD registry app calls.
 * @see {@link https://api-docs.nf.domains/reference/integrators-guide/linking-an-application-to-an-nfd}
 * @param {string} algoAddress - The Algorand address to generate the registry box name for
 * @returns {Uint8Array} The SHA-256 hash of the NFD registry box name, in bytes
 */
export async function getRegistryBoxNameForAddress(algoAddress: string): Promise<Uint8Array> {
  const prefix = new TextEncoder().encode('addr/algo/')
  const addressBytes = algosdk.decodeAddress(algoAddress).publicKey
  const data = new Uint8Array([...prefix, ...addressBytes])
  const hash = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hash)
}

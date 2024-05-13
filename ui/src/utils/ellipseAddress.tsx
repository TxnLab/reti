/**
 * Ellipsize an Algorand address with `...` (returns text only)
 * @param {string} address - The address to ellipsize
 * @param {number} width - The number of characters to display on each side of the ellipsis (default: 6)
 * @returns {string} The ellipsized address
 * @example
 * ellipseAddress('7IQQUVXUJHQ4CQSDFTYEZWEWNQZWAMCQAEJPFBZCGPOPOSJ7YZZCOH25GE')
 * // '7IQQUV...COH25GE'
 */
export function ellipseAddress(address: string = '', width: number = 6): string {
  return address ? `${address.slice(0, width)}...${address.slice(-width)}` : address
}

/**
 * Ellipsize an Algorand address with `&hellip;` HTML entity (returns JSX)
 * @param {string} address - The address to ellipsize
 * @param {number} width - The number of characters to display on each side of the ellipsis (default: 6)
 * @returns {JSX.Element} The ellipsized address
 * @example
 * ellipseAddressJsx('7IQQUVXUJHQ4CQSDFTYEZWEWNQZWAMCQAEJPFBZCGPOPOSJ7YZZCOH25GE')
 * // 7IQQUV…COH25GE
 */
export function ellipseAddressJsx(address: string = '', width: number = 6): JSX.Element {
  return address ? (
    <>
      {address.slice(0, width)}&hellip;{address.slice(-width)}
    </>
  ) : (
    <>{address}</>
  )
}

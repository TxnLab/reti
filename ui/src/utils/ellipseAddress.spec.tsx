import { render } from '@testing-library/react'
import { ellipseAddress, ellipseAddressJsx } from '@/utils/ellipseAddress'

describe('ellipseAddress', () => {
  it('should return ellipsed address with specified width', () => {
    const address = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const result = ellipseAddress(address, 4)
    expect(result).toBe('aaaa...aaaa')
  })

  it('should return empty string when address is empty', () => {
    const address = ''
    const result = ellipseAddress(address)
    expect(result).toBe('')
  })
})

describe('ellipseAddressJsx', () => {
  it('should return ellipsed address with specified width', () => {
    const address = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const width = 4

    const { container } = render(ellipseAddressJsx(address, width))

    expect(container).toHaveTextContent('aaaa…aaaa')
  })

  it('should return an empty string when the address is empty', () => {
    const address = ''

    const { container } = render(ellipseAddressJsx(address))

    expect(container.childNodes).toHaveLength(0)
  })
})

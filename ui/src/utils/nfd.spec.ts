import { Nfd } from '@/interfaces/nfd'
import {
  getNfdAvatarUrl,
  getNfdProfileUrl,
  isValidName,
  isValidRoot,
  isValidSegment,
  trimExtension,
  trimSegment,
} from '@/utils/nfd'
import { MOCK_ROOT_NFD as mockNfd } from '@/utils/tests/fixtures/nfd'

const mockBaseUrl = 'https://nfd-app.mock'

// Mock getNfdConfig
vi.mock('@/utils/network/getNfdConfig', () => ({
  getNfdAppFromViteEnvironment: vi.fn(() => mockBaseUrl),
}))

describe('isValidName', () => {
  it('should validate NFD names correctly', () => {
    expect(isValidName('example.algo')).toBe(true)
    expect(isValidName('example', true)).toBe(true)
    expect(isValidName('invalid_name.algo')).toBe(false)
  })
})

describe('isValidRoot', () => {
  it('should validate NFD roots correctly', () => {
    expect(isValidRoot('root.algo')).toBe(true)
    expect(isValidRoot('root', true)).toBe(true)
    expect(isValidRoot('invalid_root')).toBe(false)
  })
})

describe('isValidSegment', () => {
  it('should validate NFD segments correctly', () => {
    expect(isValidSegment('segment.root.algo')).toBe(true)
    expect(isValidSegment('segment.root', true)).toBe(true)
    expect(isValidSegment('invalid_segment')).toBe(false)
  })
})

describe('trimExtension', () => {
  it('should trim the .algo suffix', () => {
    expect(trimExtension('example.algo')).toBe('example')
    expect(trimExtension('root')).toBe('root')
  })
})

describe('trimSegment', () => {
  it('should trim the segment prefix', () => {
    expect(trimSegment('segment.root.algo')).toBe('root.algo')
    expect(trimSegment('root.algo')).toBe('root.algo')
    expect(trimSegment('invalid_segment')).toBe('invalid_segment')
  })
})

describe('getNfdProfileUrl', () => {
  it('should generate the correct profile URL', () => {
    expect(getNfdProfileUrl('example.algo')).toBe(`${mockBaseUrl}/name/example.algo`)
  })
})

describe('getNfdAvatarUrl', () => {
  it('should return a curated placeholder for curated NFDs', () => {
    const curatedNfd: Nfd = {
      ...mockNfd,
      category: 'curated',
      properties: { verified: {}, userDefined: {} },
    }
    expect(getNfdAvatarUrl(curatedNfd)).toBe(`${mockBaseUrl}/img/nfd-image-placeholder_gold.jpg`)
  })

  it('should return a gray placeholder for available, forSale, or reserved NFDs', () => {
    expect(getNfdAvatarUrl({ ...mockNfd, state: 'available' })).toBe(
      `${mockBaseUrl}/img/nfd-image-placeholder_gray.jpg`,
    )
    expect(getNfdAvatarUrl({ ...mockNfd, state: 'forSale' })).toBe(
      `${mockBaseUrl}/img/nfd-image-placeholder_gray.jpg`,
    )
    expect(getNfdAvatarUrl({ ...mockNfd, state: 'reserved' })).toBe(
      `${mockBaseUrl}/img/nfd-image-placeholder_gray.jpg`,
    )
  })

  it('should return a generic placeholder for other cases without an avatar', () => {
    expect(
      getNfdAvatarUrl({
        ...mockNfd,
        state: 'owned',
        properties: { verified: {}, userDefined: {} },
      }),
    ).toBe(`${mockBaseUrl}/img/nfd-image-placeholder.jpg`)
  })

  it('should return the provided avatar URL if it exists', () => {
    const nfdWithAvatar: Nfd = {
      ...mockNfd,
      properties: { verified: {}, userDefined: { avatar: 'https://mock-avatar.com/avatar.png' } },
    }
    expect(getNfdAvatarUrl(nfdWithAvatar)).toBe('https://mock-avatar.com/avatar.png')
  })
})

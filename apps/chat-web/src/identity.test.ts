import { describe, expect, it } from 'vitest'

import { displayNameForProfile, initialsForName, loadProfiles } from './identity'

describe('profile identity', () => {
  it('uses the Victoria Hermes override only for the primary profile', () => {
    expect(displayNameForProfile('default')).toBe('Victoria Hermes')
    expect(displayNameForProfile('hermes')).toBe('Victoria Hermes')
    expect(displayNameForProfile('research')).toBe('research')
  })

  it('builds a readable monogram fallback', () => {
    expect(initialsForName('Victoria Hermes')).toBe('VH')
    expect(initialsForName('research')).toBe('R')
  })

  it('loads avatar data only for profiles that declare one', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []

    const request = async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
      calls.push([method, params])

      if (method === 'profiles.list') {
        return { profiles: [{ has_avatar: true, is_default: true, name: 'default' }, { name: 'research' }] } as T
      }

      return { data: 'data:image/png;base64,avatar', found: true } as T
    }

    const profiles = await loadProfiles({ request })

    expect(profiles.default).toMatchObject({ avatar: 'data:image/png;base64,avatar', displayName: 'Victoria Hermes' })
    expect(profiles.research).toMatchObject({ avatar: null, displayName: 'research' })
    expect(calls).toEqual([
      ['profiles.list', { include_sessions: false }],
      ['profiles.get_asset', { asset: 'avatar', name: 'default' }]
    ])
  })
})

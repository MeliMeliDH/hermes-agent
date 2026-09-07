export interface GatewayRequester {
  request<T>(method: string, params: Record<string, unknown>): Promise<T>
}

export interface ProfileIdentity {
  avatar: null | string
  displayName: string
  isDefault: boolean
  name: string
}

interface ProfileListRow {
  has_avatar?: boolean
  is_default?: boolean
  name: string
}

interface ProfileListResponse {
  profiles?: ProfileListRow[]
}

interface ProfileAssetResponse {
  data?: string
  found?: boolean
}

export function displayNameForProfile(profileName: string): string {
  const normalized = profileName.trim().toLowerCase()

  return normalized === 'default' || normalized === 'hermes' ? 'Victoria Hermes' : profileName
}

export function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)

  if (parts.length === 0) {return '?'}

  return (parts.length === 1 ? parts[0]!.slice(0, 1) : `${parts[0]![0]}${parts.at(-1)![0]}`).toUpperCase()
}

export async function loadProfiles(gateway: GatewayRequester): Promise<Record<string, ProfileIdentity>> {
  const response = await gateway.request<ProfileListResponse>('profiles.list', { include_sessions: false })

  const entries = await Promise.all(
    (response.profiles ?? []).map(async profile => {
      let avatar: null | string = null

      if (profile.has_avatar) {
        try {
          const asset = await gateway.request<ProfileAssetResponse>('profiles.get_asset', {
            asset: 'avatar',
            name: profile.name
          })

          avatar = asset.found && asset.data ? asset.data : null
        } catch {
          avatar = null
        }
      }

      const identity: ProfileIdentity = {
        avatar,
        displayName: displayNameForProfile(profile.name),
        isDefault: Boolean(profile.is_default) || profile.name === 'default',
        name: profile.name
      }

      return [profile.name, identity] as const
    })
  )

  return Object.fromEntries(entries)
}

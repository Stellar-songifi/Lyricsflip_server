/**
 * class-transformer groups for serializing User entities.
 *
 * Private User fields are exposed only in these groups. The global
 * ClassSerializerInterceptor serializes without groups unless a route sets
 * them with @SerializeOptions, so a User embedded anywhere (a game session's
 * player, a wager's players, a lyric's creator, a room member) shows only its
 * public fields by default.
 */
export const UserGroup = {
  /** The authenticated user reading their own account. */
  SELF: 'user:self',
  /** Admin tooling. */
  ADMIN: 'user:admin',
} as const;

export const PRIVATE_USER_GROUPS = [UserGroup.SELF, UserGroup.ADMIN];

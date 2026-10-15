// The five roles from the URS (Cognito group names)
export const ALL_ROLES: string[] = [
  'SuperAdmin',
  'StorageAdmin',
  'SecurityAdmin',
  'BusinessUser',
  'Auditor',
];

// Which roles may use which features
export const CAN_MANAGE_BUCKETS: string[] = ['SuperAdmin', 'StorageAdmin'];
export const CAN_MANAGE_ACCESS: string[] = ['SuperAdmin', 'SecurityAdmin'];
export const CAN_VIEW_ADMIN: string[] = ['SuperAdmin', 'StorageAdmin', 'SecurityAdmin', 'Auditor'];

// True if the user is in at least one of the allowed groups
export function inAnyGroup(userGroups: string[] | null | undefined, allowed: string[]): boolean {
  return (userGroups ?? []).some((g) => allowed.includes(g));
}
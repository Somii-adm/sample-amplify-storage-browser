import type { Schema } from '../../data/resource';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/manage-users';
import { randomInt } from 'node:crypto';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUserGlobalSignOutCommand,
  AdminSetUserPasswordCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { emailFor } from '../shared/user-email';
import { ALL_ROLES, CAN_MANAGE_USERS, DATA_GROUPS, inAnyGroup } from '../../roles';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

const cognito = new CognitoIdentityProviderClient();
const POOL = process.env.USER_POOL_ID!;
const KNOWN_GROUPS = [...ALL_ROLES, ...DATA_GROUPS];
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Result = { success: boolean; message: string; temporaryPassword?: string };
const fail = (message: string): Result => ({ success: false, message });

const emailOf = (u: UserType) =>
  u.Attributes?.find((a) => a.Name === 'email')?.Value ?? u.Username ?? '';

// A random password that meets Cognito's rules (upper, lower, number, symbol)
function makeTempPassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*'];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)]); // one from each set
  while (chars.length < 14) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]]; // shuffle
  }
  return chars.join('');
}

// Cognito returns users in pages; keep asking until there are no more
async function allUsers(): Promise<UserType[]> {
  const users: UserType[] = [];
  let token: string | undefined;
  do {
    const res = await cognito.send(
      new ListUsersCommand({ UserPoolId: POOL, PaginationToken: token, Limit: 60 })
    );
    users.push(...(res.Users ?? []));
    token = res.PaginationToken;
  } while (token);
  return users;
}

async function usersInGroup(group: string): Promise<UserType[]> {
  const users: UserType[] = [];
  let token: string | undefined;
  do {
    const res = await cognito.send(
      new ListUsersInGroupCommand({ UserPoolId: POOL, GroupName: group, NextToken: token, Limit: 60 })
    );
    users.push(...(res.Users ?? []));
    token = res.NextToken;
  } while (token);
  return users;
}

async function audit(entry: {
  targetEmail: string;
  action: string;
  role?: string;
  performedBy: string;
  reason: string;
}) {
  await client.models.RoleChange.create(entry);
}

const cleanReason = (r: unknown) => String(r ?? '').trim();

// ---- Operations ----

async function listPortalUsers() {
  const users = await allUsers();
  // Work out each user's groups: ask each group for its members
  const groupsByUser = new Map<string, string[]>();
  for (const g of KNOWN_GROUPS) {
    for (const u of await usersInGroup(g)) {
      groupsByUser.set(u.Username!, [...(groupsByUser.get(u.Username!) ?? []), g]);
    }
  }
  return users
    .map((u) => ({
      username: u.Username!,
      email: emailOf(u),
      enabled: u.Enabled ?? false,
      status: u.UserStatus ?? 'UNKNOWN',
      groups: groupsByUser.get(u.Username!) ?? [],
      createdAt: (u.UserCreateDate ?? new Date()).toISOString(),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

async function createPortalUser(args: any, callerEmail: string): Promise<Result> {
  const reason = cleanReason(args.reason);
  if (reason.length < 5) return fail('Please give a reason (at least 5 characters).');

  const email = String(args.email ?? '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) return fail('Enter a valid email address.');

  const roles: string[] = (args.roles ?? []).filter(Boolean);
  if (roles.length === 0) return fail('Choose at least one role.');
  const unknown = roles.filter((r) => !KNOWN_GROUPS.includes(r));
  if (unknown.length) return fail(`Unknown role(s): ${unknown.join(', ')}.`);

  const temporaryPassword = makeTempPassword();
  let username: string;
  try {
    const res = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: POOL,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        TemporaryPassword: temporaryPassword,
        MessageAction: 'SUPPRESS', // skip Cognito's email; the admin shares the password
      })
    );
    username = res.User!.Username!;
  } catch (err: any) {
    if (err.name === 'UsernameExistsException') return fail('A user with that email already exists.');
    return fail(`Could not create user: ${err.name}`);
  }

  for (const role of roles) {
    await cognito.send(
      new AdminAddUserToGroupCommand({ UserPoolId: POOL, Username: username, GroupName: role })
    );
  }
  await audit({ targetEmail: email, action: 'CreateUser', role: roles.join(', '), performedBy: callerEmail, reason });

  return {
    success: true,
    message: `Created ${email} with role(s): ${roles.join(', ')}. Share the temporary password securely; they must change it at first sign-in.`,
    temporaryPassword,
  };
}

async function setUserRole(args: any, callerUsername: string, callerEmail: string): Promise<Result> {
  const reason = cleanReason(args.reason);
  if (reason.length < 5) return fail('Please give a reason (at least 5 characters).');
  if (!KNOWN_GROUPS.includes(args.role)) return fail('Unknown role.');

  const targetEmail = await emailFor(args.username);

  if (args.add) {
    await cognito.send(
      new AdminAddUserToGroupCommand({ UserPoolId: POOL, Username: args.username, GroupName: args.role })
    );
    await audit({ targetEmail, action: 'AddRole', role: args.role, performedBy: callerEmail, reason });
    return { success: true, message: `Added ${args.role} to ${targetEmail}. Takes effect at their next sign-in.` };
  }

  // Removing a role: protect against locking everyone out
  if (args.role === 'SuperAdmin') {
    if (args.username === callerUsername) return fail('You cannot remove your own SuperAdmin role.');
    const activeSupers = (await usersInGroup('SuperAdmin')).filter((u) => u.Enabled);
    if (activeSupers.length <= 1) return fail('At least one active SuperAdmin must remain.');
  }

  await cognito.send(
    new AdminRemoveUserFromGroupCommand({ UserPoolId: POOL, Username: args.username, GroupName: args.role })
  );
  await audit({ targetEmail, action: 'RemoveRole', role: args.role, performedBy: callerEmail, reason });
  return { success: true, message: `Removed ${args.role} from ${targetEmail}. Takes effect at their next sign-in.` };
}

async function setUserEnabled(args: any, callerUsername: string, callerEmail: string): Promise<Result> {
  const reason = cleanReason(args.reason);
  if (reason.length < 5) return fail('Please give a reason (at least 5 characters).');

  const targetEmail = await emailFor(args.username);

  if (args.enabled) {
    await cognito.send(new AdminEnableUserCommand({ UserPoolId: POOL, Username: args.username }));
    await audit({ targetEmail, action: 'EnableUser', performedBy: callerEmail, reason });
    return { success: true, message: `Enabled ${targetEmail}.` };
  }

  if (args.username === callerUsername) return fail('You cannot disable your own account.');
  const activeSupers = (await usersInGroup('SuperAdmin')).filter((u) => u.Enabled);
  if (activeSupers.some((u) => u.Username === args.username) && activeSupers.length <= 1) {
    return fail('You cannot disable the last active SuperAdmin.');
  }

  await cognito.send(new AdminDisableUserCommand({ UserPoolId: POOL, Username: args.username }));
  // Also end their other sessions (stops them refreshing their login)
  await cognito
    .send(new AdminUserGlobalSignOutCommand({ UserPoolId: POOL, Username: args.username }))
    .catch(() => {});
  await audit({ targetEmail, action: 'DisableUser', performedBy: callerEmail, reason });
  return { success: true, message: `Disabled ${targetEmail} and signed them out.` };
}

async function resetUserPassword(args: any, callerUsername: string, callerEmail: string): Promise<Result> {
  const reason = cleanReason(args.reason);
  if (reason.length < 5) return fail('Please give a reason (at least 5 characters).');
  if (args.username === callerUsername) {
    return fail('To change your own password, use "Forgot your password?" on the sign-in screen.');
  }

  const targetEmail = await emailFor(args.username);
  const temporaryPassword = makeTempPassword();

  // Permanent: false = they must choose a new password at next sign-in
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: POOL,
      Username: args.username,
      Password: temporaryPassword,
      Permanent: false,
    })
  );
  // End their existing sessions so the old password can't keep them signed in
  await cognito
    .send(new AdminUserGlobalSignOutCommand({ UserPoolId: POOL, Username: args.username }))
    .catch(() => {});
  await audit({ targetEmail, action: 'ResetPassword', performedBy: callerEmail, reason });

  return {
    success: true,
    message: `Password reset for ${targetEmail}. Share the temporary password securely; they must change it at next sign-in.`,
    temporaryPassword,
  };
}


export const handler = async (event: any) => {
  const fieldName = event.fieldName ?? event.info?.fieldName;

  // Defence in depth: SuperAdmin only, checked here too
  if (!inAnyGroup(event.identity?.groups, CAN_MANAGE_USERS)) {
    if (fieldName === 'listPortalUsers') throw new Error('You are not allowed to manage users.');
    return fail('You are not allowed to manage users.');
  }

  const callerUsername: string = event.identity?.username;
  const callerEmail = await emailFor(callerUsername);

  try {
    switch (fieldName) {
      case 'listPortalUsers':
        return await listPortalUsers();
      case 'createPortalUser':
        return await createPortalUser(event.arguments, callerEmail);
      case 'setUserRole':
        return await setUserRole(event.arguments, callerUsername, callerEmail);
      case 'setUserEnabled':
        return await setUserEnabled(event.arguments, callerUsername, callerEmail);
      case 'resetUserPassword':
        return await resetUserPassword(event.arguments, callerUsername, callerEmail);
      default:
        return fail(`Unknown operation: ${fieldName}`);
    }
  } catch (err: any) {
    if (fieldName === 'listPortalUsers') throw err;
    return fail(`Something went wrong: ${err.name ?? String(err)}`);
  }
};

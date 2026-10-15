import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient();

// Turn a Cognito username (random ID) into the user’s email
export async function emailFor(username: string | undefined): Promise<string> {
  if (!username) return 'unknown';
  try {
    const user = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: username,
      })
    );
    return user.UserAttributes?.find((a) => a.Name === 'email')?.Value ?? username;
  } catch {
    return username;
  }
}

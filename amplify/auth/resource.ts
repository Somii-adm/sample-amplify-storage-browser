import { defineAuth } from '@aws-amplify/backend';
import { ALL_ROLES } from '../roles';

export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  // 'finance' stays for now because the storage folder rules use it.
  // It goes away when the grants model replaces those rules.
  groups: [...ALL_ROLES, 'finance'],
});
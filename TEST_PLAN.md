# S3 Self-Service Portal – Test Plan (sandbox MVP)

Put this file in the root of the repo. Coding agents (Copilot agent mode) work far better
when the expected behaviour is written down. Point them at this file instead of
describing everything in chat.

---

## How the tests are organised

| Layer | What it checks | Where | How to run |
| --- | --- | --- | --- |
| **Unit tests** | The rules inside each Lambda (validation, permissions, lock-out protection). AWS is **mocked**: no AWS calls, no credentials, free and fast. | `amplify/functions/**/handler.test.ts` | `npx vitest run` |
| **End-to-end (E2E) tests** | The real deployed portal, clicked through in a real browser, one login per role. | `e2e/*.spec.ts` | `npx playwright test` |

**Rules for agents**
- Never put AWS keys anywhere. Unit tests must not call AWS.
- E2E test-user passwords live in `.env` (already ignored by git). Never commit them.
- Work on a branch (e.g. `tests`), never on `main`.
- Write results to `TEST_FINDINGS.md`. **Propose** fixes; do not change app code without asking.
- Never "fix" a failing test by weakening it. If a test fails, report it.

---

## Test users for E2E

Create one user per role in the `mvp` environment (Admin → Users) and record them in `.env`:

| Role | `.env` variables |
| --- | --- |
| SuperAdmin | `E2E_SUPER_EMAIL`, `E2E_SUPER_PASSWORD` |
| StorageAdmin | `E2E_STORAGE_EMAIL`, `E2E_STORAGE_PASSWORD` |
| SecurityAdmin | `E2E_SECURITY_EMAIL`, `E2E_SECURITY_PASSWORD` |
| Auditor | `E2E_AUDITOR_EMAIL`, `E2E_AUDITOR_PASSWORD` |
| BusinessUser | `E2E_BUSINESS_EMAIL`, `E2E_BUSINESS_PASSWORD` |
| BusinessUser + finance | `E2E_MULTI_EMAIL`, `E2E_MULTI_PASSWORD` |
| Portal URL | `E2E_BASE_URL` (the `mvp` branch URL) |

Sign in once by hand with each user first, so they've changed their temporary password.

E2E bucket names must start with `zifotest-e2e-` and end in `-dev`, e.g. `zifotest-e2e-run123-dev`,
so they're easy to spot and clean up.

---

## A. Unit tests (business rules)

Mock: S3, STS and Cognito clients (`aws-sdk-client-mock`), the `$amplify/env/*` modules,
`@aws-amplify/backend/function/runtime`, and `aws-amplify/data`'s `generateClient`
(return a fake client with in-memory `BucketRecord`, `AccessGrant`, `RoleChange` models).
Handlers receive `event.fieldName`, `event.arguments`, `event.identity.username`,
`event.identity.groups`.

### create-bucket
| ID | Case | Expected |
| --- | --- | --- |
| CB-01 | Caller not in SuperAdmin/StorageAdmin | `success:false`, no S3 calls |
| CB-02 | Name `bucket1` / `Zifotest-a-b-dev` / missing env suffix | Naming error, no S3 calls |
| CB-03 | Region other than `ap-south-1` | Region error |
| CB-04 | Classification not in list | Classification error |
| CB-05 | Owner without `@` | Owner error |
| CB-06 | Valid input | CreateBucket, PublicAccessBlock, Encryption (aws:kms, BucketKey), Versioning Enabled, Tagging, CORS all called; BucketRecord created with `status: 'Active'`; AccessGrant created for owner (lower-cased), level `Full` |
| CB-07 | CreateBucket throws `BucketAlreadyOwnedByYou` | `success:false` with the error name |
| CB-08 | A guardrail step (e.g. Versioning) throws | DeleteBucket called (rollback), `success:false` |
| CB-09 | Record save fails | `success:true` with warning; bucket NOT deleted |
| CB-10 | CORS origins | Taken from `PORTAL_ORIGINS`, split on commas |

### delete-bucket
| ID | Case | Expected |
| --- | --- | --- |
| DB-01 | Caller not a bucket manager | Refused |
| DB-02 | Name not starting `zifotest-` | Refused, no S3 call |
| DB-03 | Reason under 5 characters | Refused |
| DB-04 | S3 says `BucketNotEmpty` | Friendly "not empty" message; record unchanged |
| DB-05 | S3 says `NoSuchBucket` | Record still marked Deleted |
| DB-06 | Success | Record updated: status Deleted, deletedBy (email), deletedAt, deleteReason; every Active grant on that bucket → Revoked with revokedBy/revokedAt |

### location-access (most important: this is the data security)
| ID | Case | Expected |
| --- | --- | --- |
| LA-01 | User grant matched by email, case-insensitive | Location returned |
| LA-02 | Group grant matched via `identity.groups` | Location returned |
| LA-03 | User in two groups, one grant each | **Both** locations returned |
| LA-04 | Two grants on same bucket/prefix (Read + Full) | One location, Full permissions |
| LA-05 | Revoked grants | Ignored |
| LA-06 | Permissions mapping | Read→get,list · ReadWrite→+write · Full→+delete |
| LA-07 | Credentials for scope with no covering grant | Throws "Access denied" |
| LA-08 | `permission: 'WRITE'` or `'READWRITE'` with only a Read grant | Throws "read-only" |
| LA-09 | Folder grant `reports/` covers `s3://b/reports/2026/*` | Allowed |
| LA-10 | Grant `fin/` must NOT cover `s3://b/finance/*` | Denied |
| LA-11 | Session policy for folder grant | Object actions only on `arn:aws:s3:::b/reports/*`; ListBucket has `s3:prefix` condition `reports/*` |
| LA-12 | Session policy for whole-bucket grant | ListBucket has no condition |
| LA-13 | Read grant | Session policy has no PutObject/DeleteObject |
| LA-14 | AssumeRole | Uses `DATA_ROLE_ARN`, DurationSeconds 900 |
| LA-15 | Unknown fieldName | Throws |

### manage-access
| ID | Case | Expected |
| --- | --- | --- |
| MA-01 | Caller not SuperAdmin/SecurityAdmin | Refused |
| MA-02 | Grant to own email | Refused ("Ask another admin") |
| MA-03 | Unknown group / invalid email / unknown level | Refused |
| MA-04 | Folder `reports` → stored as `reports/`; `/reports/` → `reports/` | Normalised |
| MA-05 | Folder containing `..` or `*` | Refused |
| MA-06 | Bucket not an active portal bucket (missing or Deleted) | Refused |
| MA-07 | Duplicate active grant | Refused with existing level in message |
| MA-08 | Valid grant | Created with status Active, grantedBy = caller email |
| MA-09 | Revoke | status Revoked, revokedBy, revokedAt, revokeReason; already-revoked → refused |

### manage-users
| ID | Case | Expected |
| --- | --- | --- |
| MU-01 | Caller not SuperAdmin | Refused (list throws) |
| MU-02 | Create with no roles / unknown role / bad email / short reason | Refused |
| MU-03 | Create valid | AdminCreateUser with `MessageAction: 'SUPPRESS'`, email_verified true; AdminAddUserToGroup per role; RoleChange logged; temporary password returned |
| MU-04 | Temporary password | ≥14 chars, has upper, lower, digit, symbol |
| MU-05 | Email already exists | Friendly message |
| MU-06 | Remove own SuperAdmin role | Refused |
| MU-07 | Remove SuperAdmin from the last active SuperAdmin | Refused |
| MU-08 | Disable self | Refused |
| MU-09 | Disable last active SuperAdmin | Refused |
| MU-10 | Disable other user | AdminDisableUser + AdminUserGlobalSignOut; RoleChange logged |
| MU-11 | listPortalUsers | Combines users with their groups; sorted by email |

---

## B. End-to-end scenarios (deployed `mvp` site)

### Role visibility
| User | Admin button | Tabs visible | Delete bucket | Grant/Revoke | Users tab |
| --- | --- | --- | --- | --- | --- |
| SuperAdmin | ✅ | Create, Buckets, Access, Users | ✅ | ✅ | ✅ |
| StorageAdmin | ✅ | Create, Buckets, Access | ✅ | ❌ (read-only list) | ❌ |
| SecurityAdmin | ✅ | Buckets, Access | ❌ | ✅ | ❌ |
| Auditor | ✅ | Buckets, Access | ❌ | ❌ | ❌ |
| BusinessUser | ❌ | – | – | – | – |

### Bucket lifecycle
1. StorageAdmin creates `zifotest-e2e-<run>-dev`, owner = BusinessUser email → success message; appears in Managed buckets; Access tab shows Full grant for owner.
2. Invalid name `bucket1` → naming error, nothing created.
3. Same name again → error.
4. Row click expands tags; filters (BU, cost center, status) and column sort work.
5. Delete with wrong confirmation name → nothing deleted.
6. Delete with right name + reason → status Deleted, shows deletedBy/on/reason; owner grant Revoked.

### Grants and files
1. Owner (BusinessUser) signs in → Files shows the bucket; can upload, download, create folder, delete a file.
2. SecurityAdmin grants group `finance` ReadWrite → multi-group user sees it; can upload; no delete option.
3. SecurityAdmin grants Auditor Read on folder `reports` → Auditor sees only that folder; upload fails or is unavailable.
4. Multi-group user with grants via two groups → sees both locations.
5. SecurityAdmin tries to grant access to own email → refused.
6. Revoke the finance grant → after the user signs out and in, the location is gone.
7. Sign out and sign in as a different user → Files list updates (no previous user's locations).

### User management
1. SuperAdmin creates a user → temporary password shown; new user signs in and must change password.
2. Add a role → visible after the user signs in again; RoleChange logged.
3. Remove own SuperAdmin → refused. Disable self → refused.
4. Disable a user → they can't sign in; enable → they can.
5. Every action appears in Recent changes with who and why.

### Cleanup
Delete every `zifotest-e2e-*` bucket the run created (empty first).

---

## C. Known limitations (not bugs)

- Revoked access / disabled users: existing S3 credentials stay valid up to 15 min; existing login tokens up to ~1 hour.
- Role changes apply at the user's next sign-in.
- Buckets created before CORS was added fail to open in Files. Recreate them.
- Tags shown in the portal come from the portal's record, not live from S3.
- Lists load up to 100–1000 records; no paging yet.
- No password reset in the portal yet.

---

## D. Prompts for Copilot agent mode

**Prompt 1: unit tests**
> Read TEST_PLAN.md section A. Add vitest and aws-sdk-client-mock as dev dependencies. Write unit tests for every case ID in section A, one test file next to each handler (handler.test.ts). Mock everything listed in the section A intro; no real AWS calls. Run `npx vitest run`. Write a table of case ID → pass/fail to TEST_FINDINGS.md, and for each failure explain the cause and propose a fix. Do not change any handler code without asking me first.

**Prompt 2: E2E setup**
> Read TEST_PLAN.md section B. Set up Playwright in an `e2e/` folder, reading the base URL and test users from `.env` (make sure `.env` is in .gitignore). Write one spec file per subsection of section B. Each test signs in through the login screen. Use bucket names starting `zifotest-e2e-` and clean them up at the end. Run the tests headed so I can watch, then add results to TEST_FINDINGS.md.

**Prompt 3: review**
> Read TEST_FINDINGS.md. For each failure, show me the smallest code change that fixes it and explain why. Wait for my approval before applying each one.

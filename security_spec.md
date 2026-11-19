# AxyCore Security Specification — Phase 0 (Payload-First Security TDD)

## 1. Data Invariants
1. **Master Gate & Tenant Isolation**: Every document in all 17 collections belongs to an `organizationId` and can only be read/written by verified authenticated users (`email_verified == true`) with an active authorized role inside the same organization.
2. **No Self-Assigned Privileges**: Users registering in `users/{uid}` may only register with role `EXTERNAL_CLIENT` (unless bootstrapped primary admin `andrygallardo7@gmail.com`). Role escalation (`role` modification) is strictly restricted to `ADMIN`.
3. **Immutable Historical Records**:
   - `scoring_executions`, `committee_decisions`, `application_consents`, `disbursements`, `loans`, `loan_installments`, and `audit_logs` are **immutable** (`allow update, delete: if false;` except explicit admin emergency recovery only where documented; `audit_logs` and `committee_decisions` and `scoring_executions` are strictly append-only).
4. **Separation of Duties & Workflow Integrity**:
   - External clients (`EXTERNAL_CLIENT`) can only read/create/submit their own `applications`, `customers`, `application_documents`, `application_consents` (`createdBy == request.auth.uid`).
   - Only `CREDIT_ANALYST` or `ADMIN` can write `credit_evaluations`.
   - Only `COMMITTEE_MEMBER` or `ADMIN` can write `committee_decisions`, and non-admin deciders cannot decide on applications they created (conflict of functions).
   - Only `FORMALIZATION` or `ADMIN` can create/update `formalizations` (and only when application is approved).
   - Only `OPERATIONS`, `FINANCE`, or `ADMIN` can create `disbursements` + `loans` + `loan_installments`, and `disbursements/{applicationId}` uses deterministic ID (`applicationId`) so duplicate disbursement creation is rejected at the database layer.
5. **Temporal Integrity**: `createdAt` and `updatedAt` use server timestamps (`request.time`) and `createdAt` / `createdBy` are immutable on updates.
6. **Strict Schema & Size Guards**: Every document ID validates `^[a-zA-Z0-9_-]+$` (`<= 128` chars) and every string/list field has bounded `.size()` checks.

## 2. The "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. **Privilege Escalation on Signup**: `EXTERNAL_CLIENT` writes `users/{uid}` with `role: "ADMIN"`. -> DENIED.
2. **Ghost Field Injection (Shadow Update)**: User updates `applications/{id}` injecting `isPreApproved: true` or `bypassCommittee: true`. -> DENIED (`hasOnly`).
3. **Unverified Email Spoofing**: Request with `email: "andrygallardo7@gmail.com"` and `email_verified: false`. -> DENIED.
4. **Blanket Read / Cross-Tenant Scrape**: `EXTERNAL_CLIENT` queries `list` on `applications` without `where('createdBy', '==', uid)` or across another `organizationId`. -> DENIED.
5. **Tampering Historical Scoring Execution**: Analyst attempts `update` on `scoring_executions/{execId}` to boost `totalScore` from 49 to 90. -> DENIED (`allow update: if false`).
6. **Committee Decision Overwrite**: User attempts `update` or `delete` on `committee_decisions/{id}`. -> DENIED (`allow update, delete: if false`).
7. **Audit Log Deletion**: Admin or Auditor attempts `delete` on `audit_logs/{logId}`. -> DENIED (`allow delete: if false`).
8. **Unauthorized Approval by Business Officer**: `BUSINESS_OFFICER` attempts `create` on `committee_decisions/{id}`. -> DENIED.
9. **Double Disbursement Replay**: Operations attempts to overwrite `disbursements/{appId}` or create a second disbursement for an already disbursed application. -> DENIED (`allow update: if false`, existing doc prevents create).
10. **Disbursement Without Approval/Formalization**: Operations creates `disbursements/{appId}` when `applications/{appId}.status` is `RECIBIDA` instead of `FORMALIZADA`. -> DENIED (`get()` parent gate).
11. **ID Poisoning / Denial of Wallet**: Attacker writes document with 2KB ID or 500KB string in `firstName`. -> DENIED (`isValidId` and `.size()` limits).
12. **Client-Forged Timestamp**: Client sends `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`. -> DENIED (`== request.time`).
13. **Cross-User Notification Read/Tamper**: User A attempts to `get`, `list`, or `update` a notification in `notifications/{notificationId}` where `userId != request.auth.uid`. -> DENIED (`resource.data.userId == request.auth.uid || isAdmin()`).
14. **Self-Assigned Superadmin Escalation**: Tenant Admin or employee attempts to set `isSuperAdmin: true` in `users/{uid}` without being `isBootstrappedAdmin()`. -> DENIED (`!data.isSuperAdmin || isBootstrappedAdmin()`).
15. **Cross-Tenant License/Subscription Tampering**: Tenant A Admin attempts to create or modify `licenses/{licId}` or `subscriptions/{subId}` for Tenant B, or modify commercial licensing parameters reserved for Superadministrador. -> DENIED (`isBootstrappedAdmin()`).
16. **Mutating or Deleting Issued Fiscal e-CF**: Any user attempts `delete` on `dgii_ecf_documents/{docId}` or tries to `update` fiscal amounts/XML/eNCF once `existing().status != 'BORRADOR'`. -> DENIED (`allow delete: if false`, `update` strictly limited to status/DGII response/TrackId/accounting/void transition).
17. **Double-Entry Unbalanced Journal or Deletion**: Any user attempts to create an `accounting_journal_entries/{id}` where `totalDebit != totalCredit` or `delete` an existing journal entry. -> DENIED (`incoming().totalDebit == incoming().totalCredit`, `allow delete: if false`).
18. **Storing Private Keys in Firestore**: Attempt to inject `privateKeyPem`, `password`, or `p12Base64` inside `dgii_certificates/{id}`. -> DENIED (`hasOnly` whitelist excludes secret fields).
19. **Cross-Tenant Sequence / Config Tampering**: Tenant A Finance user writes `dgii_encf_sequences` or `dgii_fiscal_configs` for Tenant B. -> DENIED (`inSameOrg(...)`).



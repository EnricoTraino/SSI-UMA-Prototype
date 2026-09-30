# SSI-UMA Issuer Trust Prototype

Prototype integrating **Verifiable Credentials (VCs)** with **UMA Optimistic Oracle V3 (OOv3)** to assess the trustworthiness of credential issuers.

The prototype separates two different questions:

1. **Is the Verifiable Credential cryptographically valid?**
2. **Is its issuer trusted to issue that type of credential under a given policy?**

The first question is handled locally through **Veramo** and `did:key`.

The second is handled through an on-chain **IssuerTrustRegistry**, whose issuer-trust assessments are submitted to and settled through UMA Optimistic Oracle V3.

---

## Motivation

A Verifiable Credential can be cryptographically valid without its issuer necessarily being trusted or authorized to issue that particular type of credential.

Credential verification establishes that the credential's cryptographic proof
is valid against the verification material resolved for the issuer DID.
It does not, by itself, establish whether that issuer should be trusted for a
specific credential type.

This prototype therefore separates:

```text
credential authenticity
```

from:

```text
issuer trust / authorization
```

Veramo handles the first layer, while UMA OOv3 and the `IssuerTrustRegistry` provide the second.

---

## Architecture

The verification flow is divided into two independent layers.

### 1. Credential verification

Veramo verifies the credential signature and resolves the issuer DID.

A successful VC verification establishes that the credential's cryptographic proof is valid against the verification material resolved for the issuer DID.

It does **not** prove that the issuer is authorized or trusted to issue that credential.

### 2. Issuer trust verification

Issuer trust is represented on-chain by `IssuerTrustRegistry`.

An assessment is identified by the tuple:

```text
(
    issuerDidHash,
    credentialTypeHash,
    policyHash
)
```

where:

- `issuerDidHash` identifies the credential issuer;
- `credentialTypeHash` identifies the type of credential;
- `policyHash` identifies the policy under which issuer trust is evaluated.

Conceptually:

```text
Verifiable Credential
        |
        v
     Veramo
cryptographic verification
        |
        v
issuer DID + credential type
        |
        v
IssuerTrustRegistry
        |
        v
    UMA OOv3
issuer trust assessment
```

Evidence is associated with an individual UMA assertion through an `evidenceHash`, but it is not part of the assessment key.

For each assessment key, the Registry stores the latest UMA assertion through `latestAssertionId`.

This means that issuer trust is contextual: the same issuer may be trusted for one credential type or policy and not for another.

---

## Trust states

An issuer assessment can have one of the following states:

```text
None
Pending
Disputed
Trusted
Rejected
```

The typical lifecycle is:

```text
No assessment
      |
      v
   Pending
      |
      +------------------+
      |                  |
      v                  v
 undisputed           Disputed
      |                  |
      v                  |
   Trusted        +------+------+
                  |             |
                  v             v
               Trusted       Rejected
```

`Pending` means that an assertion has been created and has not yet been finally settled.

`Disputed` means that the assertion was challenged during its liveness period.

`Trusted` means that the corresponding UMA assertion was resolved as truthful. In the prototype, this is interpreted as a positive issuer-trust assessment for the specified issuer, credential type and policy.

`Rejected` means that the assertion was ultimately resolved as false.

The Registry itself does not decide whether an assertion is true or false. It records the outcome delivered through the OOv3 resolution process.

---

## Trust validity

The Registry distinguishes between two different time intervals:

- UMA assertion liveness;
- issuer trust validity duration.

`assertionLiveness` determines how long an UMA assertion can be challenged.

`validityDuration` determines how long a successful issuer assessment remains valid after it is resolved as truthful.

When an assertion is created:

```text
status = Pending
validUntil = 0
```

When it is resolved as truthful:

```text
status = Trusted
validUntil = resolution time + validityDuration
```

When it is resolved as false:

```text
status = Rejected
validUntil = 0
```

Expiration does not modify the historical status of an assessment.

Therefore an expired assessment may still have:

```text
status = Trusted
```

while:

```solidity
isAssessmentValid(assertionId) == false
```

No automatic renewal is performed. Once an assessment has expired, a new trust assessment must be explicitly created if renewed trust is required.

---

## Verification API

The prototype exposes two main verification functions.

### `verifyCredentialWithTrust`

Located in:

```text
src/verifier/verifyCredentialWithTrust.ts
```

This function is read-only.

It:

1. verifies the VC using Veramo;
2. extracts the issuer DID;
3. extracts the credential type;
4. hashes the issuer DID, credential type and policy;
5. queries `IssuerTrustRegistry`;
6. retrieves the latest assessment;
7. checks whether that assessment is currently valid.

Possible results include:

```text
VC_INVALID
NO_ASSESSMENT
ASSESSMENT_NOT_VALID
TRUSTED
```

No blockchain transaction is created by this function.

A result of `ASSESSMENT_NOT_VALID` can correspond to different underlying Registry states, including:

```text
Pending
Disputed
Rejected
Trusted but expired
```

The Registry status is returned together with the verification result when an assessment exists.

---

### `verifyCredentialAndEnsureTrust`

Located in:

```text
src/verifier/verifyCredentialAndEnsureTrust.ts
```

This function first calls `verifyCredentialWithTrust`.

Its behaviour is:

```text
VC invalid
    -> return VC_INVALID

Valid trusted assessment exists
    -> return TRUSTED

Assessment exists but is not currently valid
    -> return ASSESSMENT_NOT_VALID

No assessment exists
    -> create a new UMA assertion
    -> return ASSESSMENT_PENDING
```

A new UMA assertion is therefore created only when no assessment exists for the tuple:

```text
issuer DID
+
credential type
+
policy
```

This prevents duplicate assertions from being automatically created while an existing assessment is already Pending, Disputed, Rejected or expired.

---

## Smart contracts

### `IssuerTrustRegistry.sol`

The main contract of the prototype is:

```text
contracts/IssuerTrustRegistry.sol
```

Its responsibilities include:

- creating issuer-trust assertions through OOv3;
- storing issuer, credential type and policy associations;
- storing evidence hashes;
- tracking the latest assertion for each assessment key;
- receiving OOv3 dispute callbacks;
- receiving OOv3 resolution callbacks;
- tracking assessment status;
- storing trust validity durations;
- exposing current assessment validity.

The Registry does not perform credential signature verification.

That responsibility remains entirely in the Veramo layer.

---

### Mock contracts

The repository also contains:

```text
contracts/mocks/MockERC20.sol
contracts/mocks/MockOptimisticOracleV3.sol
```

These contracts are used by the automated local test suite.

They provide deterministic testing of:

```text
Pending
Disputed
Trusted
Rejected
expiration
bond flows
OOv3 callbacks
```

`MockOptimisticOracleV3` implements the subset of OOv3 behaviour required by the automated tests, including assertions, disputes, settlement and callbacks.

Its `setResolution` function simulates the final oracle outcome. It does not implement UMA DVM voting.

The mock contracts are separate from the UMA local sandbox integration described below.

---

## UMA local integration

In addition to the mock-based automated tests, the prototype was tested against the **official UMA OOv3 local sandbox** running on Anvil.

In this environment, the Registry interacts with an actual local deployment of the UMA OOv3 contracts rather than `MockOptimisticOracleV3`.

The sandbox integration was used to validate the following paths:

```text
Pending -> Trusted

Pending -> Disputed -> Trusted

Pending -> Disputed -> Rejected
```

This includes actual OOv3 calls and callbacks to `IssuerTrustRegistry`.

For disputed assertions, the sandbox's `MockOracleAncillary` is used to provide the final oracle result.

Therefore:

```text
OOv3 interaction and callbacks
    -> actual UMA contracts

final disputed assertion resolution
    -> sandbox MockOracleAncillary
```

The local sandbox validates integration with OOv3 but does not reproduce the complete economic and voting process of a production UMA DVM.

---

## Test structure

The project currently contains two automated test suites.

### Registry tests

```text
test/IssuerTrustRegistry.test.ts
```

These tests exercise the Registry contract directly.

The current cases include:

```text
creation
    -> Pending

undisputed settlement
    -> Trusted

disputed assertion
    -> asserter wins
    -> Trusted

disputed assertion
    -> disputer wins
    -> Rejected
```

They also verify:

- validity duration;
- expiration;
- bond transfers;
- dispute callbacks;
- resolution callbacks;
- current assessment validity.

---

### Verifier tests

```text
test/Verifier.test.ts
```

These tests combine:

```text
Veramo
+
signed Verifiable Credentials
+
IssuerTrustRegistry
+
MockOptimisticOracleV3
```

The current tests cover:

```text
NO_ASSESSMENT
Pending
Trusted
Disputed
Rejected
```

They verify the behaviour of both:

```text
verifyCredentialWithTrust
```

and:

```text
verifyCredentialAndEnsureTrust
```

against an actual locally deployed Registry.

---

## Repository structure

```text
contracts/
├── IssuerTrustRegistry.sol
├── interfaces/
│   ├── IERC20Benchmark.sol
│   └── IOptimisticOracleV3.sol
└── mocks/
    ├── MockERC20.sol
    └── MockOptimisticOracleV3.sol

scripts/
├── BenchmarkOOv3.ts
├── DeployRealRegistry.ts
├── Dispute.ts
├── runRealColdPath.ts
├── settleAssessment.ts
└── utils/
    └── assertionStore.ts

src/
├── veramo/
│   ├── setup.ts
│   └── testVC.ts
└── verifier/
    ├── BenchmarkTrust.ts
    ├── verifyCredentialAndEnsureTrust.ts
    └── verifyCredentialWithTrust.ts

test/
├── IssuerTrustRegistry.test.ts
└── Verifier.test.ts
```

The main application logic is contained in:

```text
src/verifier/
```

The contracts are contained in:

```text
contracts/
```

while `scripts/` contains deployment, interaction and experimental integration workflows.

---

## Requirements

The core project requires:

```text
Node.js
npm
Hardhat 3
```

For the full UMA local sandbox integration, the following are also required:

```text
Foundry
Anvil
UMA dev-quickstart-oov3
```

---

## Installation

Install the project dependencies:

```bash
npm install
```

Compile the Solidity contracts:

```bash
npm run compile
```

Run the TypeScript type checker:

```bash
npm run typecheck
```

---

## Running the automated tests

Run the complete automated test suite with:

```bash
npm test
```

The current suite contains:

```text
4 IssuerTrustRegistry tests
2 Verifier tests
```

Individual suites can also be executed separately.

Registry tests:

```bash
npx hardhat test test/IssuerTrustRegistry.test.ts
```

Verifier tests:

```bash
npx hardhat test test/Verifier.test.ts
```

---

## Test Verifiable Credential

The script:

```text
src/veramo/testVC.ts
```

acts as a simple test issuer.

It creates:

- a test issuer `did:key`;
- a test subject `did:key`;
- a signed `UniversityDegreeCredential`.

The resulting credential can be persisted in:

```text
results/test-vc.json
```

Separating credential issuance from the trust-verification workflow allows the verifier to operate on an already-issued signed credential rather than generating a new issuer identity during every verification run.

The test issuer is a controlled prototype identity.

It does **not** represent a real university, certification authority or institution.

---

## Deploying the Registry

The deployment script is:

```text
scripts/DeployRealRegistry.ts
```

It requires explicit addresses for:

```text
OOV3_ADDRESS
COLLATERAL_ADDRESS
```

For example, in PowerShell:

```powershell
$env:OOV3_ADDRESS="..."
$env:COLLATERAL_ADDRESS="..."
```

or in Bash:

```bash
export OOV3_ADDRESS="..."
export COLLATERAL_ADDRESS="..."
```

The deployment script intentionally does not contain implicit network-specific fallback addresses.

This reduces the risk of accidentally deploying the Registry against the wrong OOv3 or collateral contract.

---

## Assessment workflow scripts

The main workflow scripts are:

```text
scripts/runRealColdPath.ts
scripts/Dispute.ts
scripts/settleAssessment.ts
```

### `runRealColdPath.ts`

This script loads an already-issued VC and checks whether an issuer-trust assessment already exists.

Its effective flow is:

```text
load signed VC
      |
      v
verify credential
      |
      v
query Registry
      |
      +--> valid Trusted assessment
      |        -> return existing trust
      |
      +--> assessment exists but is not valid
      |        -> do not create another assertion
      |
      +--> no assessment
               -> create new UMA assertion
```

Despite its historical name, the script is able to detect both existing assessments and the absence of an assessment.

---

### `Dispute.ts`

This script selects an existing assertion and submits a dispute through OOv3.

The disputer approves the OOv3 contract directly for the required bond before disputing the assertion.

---

### `settleAssessment.ts`

This script settles an existing assertion after the required OOv3 conditions have been satisfied.

The resulting Registry state depends on the final assertion resolution.

---

## Assertion store

Runtime assertion metadata is maintained by:

```text
scripts/utils/assertionStore.ts
```

The corresponding JSON data is used only for off-chain bookkeeping by the interaction scripts.

It may contain information such as:

```text
assertion ID
Registry address
OOv3 address
collateral address
transaction metadata
current recorded workflow state
```

This file is **not** the source of truth for issuer trust.

The authoritative state is stored on-chain in `IssuerTrustRegistry` and UMA OOv3.

---

## Collateral and bond flow

Creating a new issuer assessment requires an assertion bond.

The simplified flow is:

```text
asserter
   |
   | approve
   v
IssuerTrustRegistry
   |
   | transferFrom
   v
Registry
   |
   | approve
   v
UMA OOv3
```

The Registry uses the larger of:

```text
configured Registry bond
```

and:

```text
OOv3 minimum bond for the selected collateral
```

A disputer approves OOv3 directly for the corresponding dispute bond.

Bond distribution after resolution is handled according to the OOv3 outcome.

---

## Security and scope

This repository is a research prototype and is **not production-ready software**.

Important limitations include:

- no security audit has been performed;
- test `did:key` identities represent controlled prototype identities only;
- issuer trust depends on the formulation of the UMA assertion and the associated policy;
- `evidenceHash` only commits to evidence data and does not independently guarantee its quality or authenticity;
- the prototype does not implement a complete issuer-governance framework;
- the prototype does not implement credential revocation infrastructure;
- the local UMA sandbox does not reproduce the full production DVM voting process;
- economic parameters such as bond sizes and validity durations are prototype configuration choices.

In particular, UMA does **not** verify the cryptographic authenticity of Verifiable Credentials.

Veramo performs credential verification.

UMA is used to assess the separate claim that an issuer should be trusted for a particular credential type under a specified policy.

---

## Testnet experimentation

Earlier development also investigated a dispute path on Ethereum Sepolia.

In the tested setup, a complete DVM voting and dispute-resolution cycle could not be exercised reliably.

For this reason, final local dispute integration testing was performed using UMA's official OOv3 sandbox and its `MockOracleAncillary` for the final oracle result.

The current deployment workflow no longer relies on hard-coded Sepolia OOv3 or collateral addresses.

---

## Results and benchmarking

The repository contains two benchmarking utilities:

```text
src/verifier/BenchmarkTrust.ts
scripts/BenchmarkOOv3.ts
```

They measure two distinct parts of the prototype: the off-chain verification path and the on-chain issuer-assessment lifecycle.

### Off-chain trust verification

`BenchmarkTrust.ts` measures the warm verification path when a valid `Trusted` assessment already exists.

The benchmark separately measures Verifiable Credential verification through Veramo, Registry trust lookup, and the complete `verifyCredentialWithTrust` flow.

After 10 warm-up iterations, 100 iterations were measured.

VC verification alone required approximately 7.45 ms on average, while a Registry trust lookup required approximately 3.65 ms.

The complete VC verification and trust-check flow required approximately 10.24 ms on average.

Therefore, in the local benchmark environment, adding issuer-trust verification to VC verification introduced approximately 2.79 ms of additional average execution time.

The separately measured VC-verification and trust-lookup averages sum to approximately 11.10 ms, slightly more than the 10.24 ms observed for the combined flow. This difference is attributed to normal runtime, caching, provider and execution-order variation and should not be interpreted as an optimization.

Raw off-chain benchmark results are stored in:

```text
results/benchmark-trust.json
```

### UMA OOv3 lifecycle benchmark

`BenchmarkOOv3.ts` measures the on-chain issuer-assessment lifecycle.

The final benchmark was executed on a fresh local Anvil chain using the UMA OOv3 sandbox. The Registry interacted with the actual local Optimistic Oracle V3 contracts rather than `MockOptimisticOracleV3`.

For disputed assertions, the sandbox `MockOracleAncillary` was used only to provide the final oracle result required to complete the dispute flow. Therefore, the benchmark exercises actual OOv3 assertion, dispute, settlement and callback mechanisms, but does not measure UMA DVM voting or production oracle-resolution latency.

The benchmark consists of 10 runs covering three assessment paths:

```text
Pending -> Trusted
Pending -> Disputed -> Trusted
Pending -> Disputed -> Rejected
```

Funding and ERC-20 approval transactions are setup operations and are excluded from the measurements. The transaction used to provide the final `MockOracleAncillary` result is also excluded from settlement timing.

Across the 10 runs, 80 on-chain transactions were measured.

For the undisputed path, assertion creation followed by settlement required approximately 176.61 ms on average in the local environment, with a typical total cost of approximately 505,882 gas.

For the disputed path that ultimately resolved as truthful, the complete assertion, dispute and settlement lifecycle required approximately 241.84 ms on average, with a typical total cost of approximately 895,296 gas.

For the disputed path that ultimately resolved as false, the complete lifecycle required approximately 256.59 ms on average, with a typical total cost of approximately 890,088 gas.

The median gas consumption of the individual operations was approximately 427,608 gas for assertion creation, 78,274 gas for undisputed settlement, 344,179 gas for a dispute, 123,509 gas for a disputed settlement resolving as `Trusted`, and 118,301 gas for a disputed settlement resolving as `Rejected`.

A first-use effect was observed on the fresh sandbox. For example, the first assertion consumed 460,284 gas, while the median assertion cost was 427,608 gas. These first-run observations are retained in the raw dataset rather than being removed.

Transaction fees are recorded by the benchmark but should not be interpreted as general Ethereum transaction-cost estimates because they depend on the local Anvil base fee.

Similarly, the measured execution times characterize the local development environment and should not be interpreted as Ethereum mainnet confirmation times or production UMA DVM resolution times.

Raw on-chain benchmark results are stored in:

```text
results/oov3-benchmark.csv
```

---

## Future work

Possible extensions include:

- broader automated verifier test coverage;
- expired-trust and policy-isolation tests;
- multiple credential types for the same issuer;
- richer issuer-policy models;
- more structured evidence handling;
- production DVM integration;
- performance evaluation on public networks and production-like oracle-resolution environments;
- external issuer registries or governance mechanisms;
- credential revocation support.

---

## Project status

The current prototype implements:

```text
signed Verifiable Credential verification
+
issuer / credential type / policy trust keys
+
on-chain trust Registry
+
UMA OOv3 assertions
+
disputes
+
truthful and false resolutions
+
time-limited trust validity
+
warm trust lookup
+
automatic assertion creation when no assessment exists
```

The current automated test suite validates the Registry and verifier logic, while the UMA local sandbox provides an additional integration layer against the actual OOv3 contracts.

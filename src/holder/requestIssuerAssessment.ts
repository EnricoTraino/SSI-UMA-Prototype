import {id , toUtf8Bytes} from "ethers";
import { performance } from "node:perf_hooks";

export async function requestIssuerAssessmentAsHolder(
    registry : any,
    holderSigner : any,
    issuerDid : string,
    credentialType : string,
    policy : string,
    evidence : string,
    validitySeconds : number,
    claimOverride? : string
){

    const issuerDidHash = id(issuerDid);
    const credentialTypeHash = id(credentialType);
    const policyHash = id(policy);
    const evidenceHash = id(evidence);

    const defaultClaimText =
        "For the SSI-UMA prototype test only, issuer " + issuerDid + 
        " is designated as an authorized test issuer for " + credentialType + 
        " under policy " + policy;

    const claimText = claimOverride ?? defaultClaimText;

    const claim = toUtf8Bytes(claimText);

    const transactionStart = performance.now();

    const tx = await registry.connect(holderSigner).requestIssuerAssessment(
        claim,
        issuerDidHash,
        credentialTypeHash,
        policyHash,
        evidenceHash,
        BigInt(validitySeconds)
    );

    const transactionSubmitted = performance.now();

    const receipt = await tx.wait();

    const transactionConfirmed = performance.now();

    if(receipt == null){
        throw new Error("assertion transaction receipt not found");
    }

    const transactionSubmissionTimeMs =
        transactionSubmitted -
        transactionStart;

    const transactionConfirmationTimeMs =
        transactionConfirmed -
        transactionSubmitted;

    const transactionTotalTimeMs =
        transactionConfirmed -
        transactionStart;

    const assessmentKey = await registry.computeAssessmentKey(
        issuerDidHash,
        credentialTypeHash,
        policyHash
    );

    const assertionId = await registry.latestAssertionId(assessmentKey);

    //nuova assessment: pending

    return {
        reason: "ASSESSMENT_PENDING",
        issuerDid,
        credentialType,
        claim : claimText,
        evidence,
        assertionId,
        gasUsed: receipt.gasUsed,
        transactionHash : receipt.hash,
        blockNumber : receipt.blockNumber,
        feeWei : receipt.fee,
        transactionSubmissionTimeMs,
        transactionConfirmationTimeMs,
        transactionTotalTimeMs
    };
}
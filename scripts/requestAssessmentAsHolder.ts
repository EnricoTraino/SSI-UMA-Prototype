import {network} from "hardhat";
import {performance} from "node:perf_hooks";
import fs from "node:fs";
import { requestIssuerAssessmentAsHolder } from "../src/holder/requestIssuerAssessment.js";
import {loadAssertionStore , saveAssertionStore} from "./utils/assertionStore.js";

async function main(){

    const connection = await network.create();
    
    const {ethers} = connection;
    
    const networkName = connection.networkName;
    const assertionStore = loadAssertionStore(networkName);
    
    const [holder] = await ethers.getSigners();
    const holderAddress = await holder.getAddress();
    
    const deployment = JSON.parse(fs.readFileSync(`results/${networkName}-deployment.json` , "utf8"));

    //richiesta prodotta dal verifier
    
    const assessmentRequest = JSON.parse(
        fs.readFileSync(
            "results/assessment-request.json",
            "utf8"
        )
    );
    
    const {issuerDid , credentialType , policy} = assessmentRequest;

    if (!issuerDid || !credentialType || !policy) {
        throw new Error(
            "Invalid assessment request"
        );
    }

    const registry = await ethers.getContractAt(
        "IssuerTrustRegistry",
        deployment.registryAddress
    );

    const collateral = await ethers.getContractAt(
        "IERC20Benchmark",
        deployment.collateralAddress
    );

    const collateralDecimals = await collateral.decimals();
    const collateralSymbol = await collateral.symbol();

    const oo = await ethers.getContractAt(
        "IOptimisticOracleV3",
        deployment.ooAddress
    );

    const minimumBond = await oo.getMinimumBond(deployment.collateralAddress);

    const configuredBond = await registry.bond();

    const requiredBond = configuredBond > minimumBond ? configuredBond : minimumBond;

    const collateralBalance = await collateral.balanceOf(holderAddress);

    console.log("\nHOLDER ASSESSMENT REQUEST\n");
    console.log("registry: " , deployment.registryAddress);
    console.log("asserter: " , holderAddress);
    console.log(
        "minimum bond:",
        ethers.formatUnits(minimumBond, collateralDecimals),
        collateralSymbol
    );

    console.log(
        "collateral balance:",
        ethers.formatUnits(collateralBalance, collateralDecimals),
        collateralSymbol
    );

    if(collateralBalance < requiredBond){
        throw new Error(`Insufficient ${collateralSymbol} balance`);
    }

    const currentAllowance = await collateral.allowance(holderAddress , deployment.registryAddress);

    let approveReceipt = null;

    let approveSubmissionTimeMs = 0;
    let approveConfirmationTimeMs = 0;
    let approveTotalTimeMs = 0;

    if(currentAllowance < requiredBond){

        const approveStart = performance.now();

        const approveTx = await collateral.connect(holder).approve(
            deployment.registryAddress,
            requiredBond
        )

        const approveSubmitted = performance.now();

        approveReceipt = await approveTx.wait();

        const approveConfirmed = performance.now();

        if(approveReceipt == null){
            throw new Error("approve receipt not found");
        }

        approveSubmissionTimeMs = approveSubmitted - approveStart;

        approveConfirmationTimeMs = approveConfirmed - approveSubmitted;

        approveTotalTimeMs = approveConfirmed - approveStart;

        console.log("\nAPPROVE COMPLETED\n");

        console.log("gas: " , approveReceipt.gasUsed.toString());
        console.log("fee: " , ethers.formatEther(approveReceipt.fee) , "ETH");
        console.log("total time: " , approveTotalTimeMs , "ms");
    
    }
    else{
        console.log("\nregistry already has sufficient allowance");
    }


    const evidence = "SSI-UMA prototype test evidence";

    const requestStart = performance.now();

    const result = await requestIssuerAssessmentAsHolder(
        registry,
        holder,
        issuerDid,
        credentialType,
        policy,
        evidence,
        60 * 60 * 24 * 5
    );

    const requestEnd = performance.now();
    const requestTotalTimeMs = requestEnd - requestStart;

    if (result.reason != "ASSESSMENT_PENDING") {
        throw new Error(
            `Unexpected assessment request result: ${result.reason}`
        );
    }

    if (
        !("transactionHash" in result) ||
        !("blockNumber" in result) ||
        !("gasUsed" in result) ||
        !("feeWei" in result) ||
        !("assertionId" in result) ||  
        !("transactionSubmissionTimeMs" in result) ||
        !("transactionConfirmationTimeMs" in result) ||
        !("transactionTotalTimeMs" in result) ||
        !("claim" in result) ||
        !("evidence" in result)
    ) {
        throw new Error(
            "Missing assertion transaction data"
        );
    }

    const assertionFeeETH = ethers.formatEther(result.feeWei);
    
    console.log("\nASSERTION CREATED\n");
    
    console.log("Assertion ID:" , result.assertionId);
    console.log("Transaction:" , result.transactionHash);
    console.log("Gas used:",result.gasUsed.toString());
    console.log("Fee:",assertionFeeETH,"ETH");
    console.log("Transaction submission:" , result.transactionSubmissionTimeMs , "ms");
    console.log("Transaction confirmation:" , result.transactionConfirmationTimeMs , "ms");
    console.log("Transaction total:" , result.transactionTotalTimeMs , "ms");
    console.log("Holder request total:" , requestTotalTimeMs , "ms");
    console.log("submission:" , approveSubmissionTimeMs , "ms");
    console.log("confirmation:" , approveConfirmationTimeMs , "ms");
    
    //salvataggio assertion
    
    const assertionData = {
    
        createdAt : new Date().toISOString(),
        network : networkName,
        registryAddress : deployment.registryAddress,
        ooAddress : deployment.ooAddress,
        collateralAddress : deployment.collateralAddress,
        assertionId : result.assertionId,
        claim : result.claim,
        issuerDid : result.issuerDid,
        status : "Pending",
        credentialType : result.credentialType,
        policy,
        transactionHash : result.transactionHash,
        blockNumber : result.blockNumber,
        gasUsed : result.gasUsed.toString(),
        feeWei : result.feeWei.toString(),
        feeETH : assertionFeeETH,
        evidence : result.evidence
    };
    
    assertionStore.assertions[result.assertionId] = assertionData;
    assertionStore.latestAssertionId = result.assertionId;
    saveAssertionStore(assertionStore , networkName);
    
    

    console.log("\nAssertion data saved successfully");
}
    
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
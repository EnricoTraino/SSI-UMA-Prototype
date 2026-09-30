import { network } from "hardhat";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import {selectAssertion , saveAssertionStore} from "./utils/assertionStore.js";

function statusName(status : bigint) : string{
    const names = ["None" , "Pending" , "Disputed" , "Trusted" , "Rejected"];
    return names[Number(status)] ?? `Unknown (${status.toString()})`;
}

async function main(){

    const connection = await network.create();

    const {ethers} = connection;

    const networkName = connection.networkName;

    const signers = await ethers.getSigners();

    if(signers.length < 2){
        throw new Error("second signer not configured");
    }

    const asserter = signers[0];
    const disputer = signers[1];

    const asserterAddress = await asserter.getAddress();
    const disputerAddress = await disputer.getAddress();

    const {store , assertionId , assertion : savedAssertion} = await selectAssertion(networkName);

    const registryAddress: string = savedAssertion.registryAddress;
    const ooAddress: string = savedAssertion.ooAddress;
    const collateralAddress: string = savedAssertion.collateralAddress;

    if (
        !registryAddress ||
        !ooAddress ||
        !collateralAddress
    ) {
        throw new Error(
            "selected assertion is missing contract addresses"
        );
    }


    const registry = await ethers.getContractAt(
        "IssuerTrustRegistry",
        registryAddress
    );

    const oo = await ethers.getContractAt(
        "IOptimisticOracleV3",
        ooAddress
    );

    const collateral = await ethers.getContractAt(
        "IERC20Benchmark",
        collateralAddress
    );

    const decimals = await collateral.decimals();
    const symbol = await collateral.symbol();

    console.log("\nDISPUTE ASSESSMENT\n");

    console.log(
        "registry:",
        registryAddress
    );

    console.log(
        "OOv3:",
        ooAddress
    );

    console.log(
        "asserter:",
        asserterAddress
    );

    console.log(
        "disputer:",
        disputerAddress
    );

    console.log(
        "assertionId:",
        assertionId
    );

    //pre-dispute state

    const lookupStart = performance.now();

    const [assertionBefore , assessmentBefore] = await Promise.all([
        oo.getAssertion(assertionId),
        registry.assessments(assertionId)
    ]);

    const lookupEnd = performance.now();

    const lookupTimeMs = lookupEnd - lookupStart;

    if (
        assertionBefore.asserter.toLowerCase() !=
        asserterAddress.toLowerCase()
    ) {
        throw new Error(
            "assertion asserter does not match configured first signer"
        );
    }


    if (assessmentBefore.status == 0n) {
        throw new Error(
            "Assertion not registered in current registry"
        );
    }

    if (assertionBefore.settled) {
        throw new Error(
            "Assertion already settled"
        );
    }

    if (
        assertionBefore.disputer
        != ethers.ZeroAddress
    ) {
        throw new Error(
            "Assertion already disputed"
        );
    }

    const latestBlock = await ethers.provider.getBlock("latest");

    if(latestBlock == null){
        throw new Error("latest block not found");
    }

    if(BigInt(latestBlock.timestamp) >= assertionBefore.expirationTime){
        throw new Error("assertion expired");
    }

    if(assertionBefore.callbackRecipient.toLowerCase() != registryAddress.toLowerCase()){
        throw new Error("assertion belongs to another registry");
    }

    if (
        assertionBefore.escalationManagerSettings
            .assertingCaller.toLowerCase() !==
        registryAddress.toLowerCase()
    ) {
        throw new Error(
            "assertion was not created by the current registry"
        );
    }

    if (
        assertionBefore.currency.toLowerCase() !==
        collateralAddress.toLowerCase()
    ) {
        throw new Error(
            "assertion collateral does not match expected collateral"
        );
    }

    const bond = assertionBefore.bond;
    const balanceBefore = await collateral.balanceOf(disputerAddress);

    console.log(
        "\nBEFORE DISPUTE\n"
    );

    console.log("registry status:" , statusName(assessmentBefore.status));

    console.log("bond:",
        ethers.formatUnits(
            bond,
            decimals
        ),
        symbol
    );

    console.log("disputer balance:",
        ethers.formatUnits(
            balanceBefore,
            decimals
        ),
        symbol
    );

    console.log("expiration:",
        new Date(
            Number(
                assertionBefore.expirationTime
            ) * 1000
        ).toISOString()
    );

    console.log("lookup time:" , lookupTimeMs , "ms");

    if (balanceBefore < bond) {
        throw new Error(
            `Disputer has insufficient ${symbol}`
        );
    }


    //approve OOv3

    const allowance = await collateral.allowance(
        disputerAddress,
        ooAddress
    );

    let approveData : any = null;

    if(allowance < bond){

        console.log("\nAPPROVING OOV3\n");

        const approveStart = performance.now();

        const approveTx = await collateral.connect(disputer).approve(ooAddress , bond);

        const approveSubmitted = performance.now();

        const approveReceipt = await approveTx.wait();

        const approveConfirmed = performance.now();

         if (approveReceipt === null) {
            throw new Error(
                "Approve receipt not found"
            );
        }

        approveData = {
            transactionHash : approveReceipt.hash,
            blockNumber : approveReceipt.blockNumber,
            gasUsed : approveReceipt.gasUsed.toString(),
            feeWei : approveReceipt.fee.toString(),
            feeETH : ethers.formatEther(approveReceipt.fee),
            submissionTimeMs : approveSubmitted - approveStart,
            confirmationTimeMs : approveConfirmed - approveSubmitted,
            totalTimeMs : approveConfirmed - approveStart
        };

        console.log(
            "approve gas:",
            approveData.gasUsed
        );

        console.log(
            "approve fee:",
            approveData.feeETH,
            "ETH"
        );
    }
    else{

        console.log(
            "\nOOv3 already has sufficient allowance"
        );
    }

    const blockBeforeDispute =
        await ethers.provider.getBlock(
            "latest"
        );

    if (blockBeforeDispute === null) {
        throw new Error(
            "Latest block not found"
        );
    }

    if (
        BigInt(blockBeforeDispute.timestamp)
        >= assertionBefore.expirationTime
    ) {
        throw new Error(
            "Assertion expired while preparing dispute"
        );
    }
    
    const secondsRemaining =
        Number(assertionBefore.expirationTime) -
        blockBeforeDispute.timestamp;

    console.log(
        "seconds remaining before expiration:",
        secondsRemaining
    );

    if (secondsRemaining < 60) {
        throw new Error(
            "Less than 60 seconds remain before expiration. Dispute aborted."
        );
    }

    //dispute

    console.log("\nSENDING DISPUTE\n");

    const disputeStart = performance.now();

    const disputeTx = await oo.connect(disputer).disputeAssertion(assertionId , disputerAddress);

    const disputeSubmitted = performance.now();

    const disputeReceipt = await disputeTx.wait();

    const disputeConfirmed = performance.now();

    if(disputeReceipt == null){
        throw new Error("dispute receipt not found");
    }

    const submissionTimeMs = disputeSubmitted - disputeStart;
    const confirmationTimeMs = disputeConfirmed - disputeSubmitted;
    const totalTimeMs = disputeConfirmed - disputeStart;


    //post-dispute state

    const postLookupStart = performance.now();

    const [assertionAfter , assessmentAfter] = await Promise.all([
        oo.getAssertion(assertionId),
        registry.assessments(assertionId)
    ]);

    const postLookupEnd = performance.now();

    const postLookupTimeMs = postLookupEnd - postLookupStart;

    const balanceAfter = await collateral.balanceOf(disputerAddress);

    const balanceDelta = balanceAfter - balanceBefore;

    console.log(
        "\nAFTER DISPUTE\n"
    );

    console.log(
        "registry status:",
        statusName(
            assessmentAfter.status
        )
    );

    console.log(
        "OOv3 disputer:",
        assertionAfter.disputer
    );

    console.log(
        "gas used:",
        disputeReceipt.gasUsed
            .toString()
    );

    console.log(
        "fee:",
        ethers.formatEther(
            disputeReceipt.fee
        ),
        "ETH"
    );

    console.log(
        "submission time:",
        submissionTimeMs,
        "ms"
    );

    console.log(
        "confirmation time:",
        confirmationTimeMs,
        "ms"
    );

    console.log(
        "total time:",
        totalTimeMs,
        "ms"
    );

    console.log(
        "disputer collateral delta:",
        ethers.formatUnits(
            balanceDelta,
            decimals
        ),
        symbol
    );

    console.log(
        "post-dispute lookup:",
        postLookupTimeMs,
        "ms"
    );

    if (
        assertionAfter.disputer
            .toLowerCase()
        !== disputerAddress.toLowerCase()
    ) {
        throw new Error(
            "OOv3 did not register expected disputer"
        );
    }

    if (
        statusName(
            assessmentAfter.status
        ) !== "Disputed"
    ) {
        throw new Error(
            "Registry did not enter Disputed state"
        );
    }

    //save results

    const disputeData = {
        network : networkName,
        registryAddress,
        ooAddress,
        assertionId,
        asserterAddress,
        disputerAddress,
        bond : bond.toString(),
        collateralSymbol : symbol,
        approve : approveData,
        disputeTransactionHash : disputeReceipt.hash,
        disputeBlockNumber : disputeReceipt.blockNumber,
        disputeGasUsed : disputeReceipt.gasUsed.toString(),
        disputeFeeWei : disputeReceipt.fee.toString(),
        disputeFeeETH : ethers.formatEther(disputeReceipt.fee),
        lookupBeforeTimeMs : lookupTimeMs,
        disputeSubmissionTimeMs : submissionTimeMs,
        disputeConfirmationTimeMs : confirmationTimeMs,
        disputeTotalTimeMs : totalTimeMs,
        lookupAfterTimeMs : postLookupTimeMs,
        disputeBalanceBefore : balanceBefore.toString(),
        disputeBalanceAfter : balanceAfter.toString(),
        disputeBalanceDelta : balanceDelta.toString(),
        statusBefore : statusName(assessmentBefore.status),
        statusAfter : statusName(assessmentAfter.status)
    };

    store.assertions[assertionId].dispute = disputeData;
    store.assertions[assertionId].status = "Disputed";
    saveAssertionStore(store , networkName);

    const csvPath = `results/${networkName}-benchmark.csv`;


    if (approveData !== null) {

        const approveRow =
            "setup,approve_disputer_collateral," +
            assertionId + "," +
            approveData.transactionHash + "," +
            approveData.blockNumber + "," +
            approveData.gasUsed + "," +
            approveData.feeWei + "," +
            approveData.feeETH + "," +
            approveData.submissionTimeMs + "," +
            approveData.confirmationTimeMs + "," +
            approveData.totalTimeMs + "\n";

        fs.appendFileSync(
            csvPath,
            approveRow
        );
    }

    const disputeRow =
        "dispute,dispute_assertion," +
        assertionId +  "," +
        disputeReceipt.hash + "," +
        disputeReceipt.blockNumber + "," +
        disputeReceipt.gasUsed.toString() + "," +
        disputeReceipt.fee.toString() + "," +
        ethers.formatEther(
            disputeReceipt.fee
        ) + "," +
        submissionTimeMs + "," +
        confirmationTimeMs + "," +
        totalTimeMs + "\n";

    fs.appendFileSync(csvPath , disputeRow);

    console.log(`\nSaved dispute data to results/${networkName}-assertion.json`);

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
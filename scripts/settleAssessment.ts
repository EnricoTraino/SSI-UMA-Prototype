import {network} from "hardhat";
import {performance} from "node:perf_hooks";
import {selectAssertion , saveAssertionStore} from "./utils/assertionStore.js";
import fs from "node:fs";

function statusName(status : bigint) : string{
    const names = ["None" , "Pending" , "Disputed" , "Trusted" , "Rejected"];
    return names[Number(status)] ?? `Unknown (${status.toString()})`;
}

async function main(){

    const connection = await network.create();

    const {ethers} = connection;

    const networkName = connection.networkName;

    const [signer] = await ethers.getSigners();

    const {store , assertionId , assertion : savedAssertion} = await selectAssertion(networkName);

    const registryAddress : string = savedAssertion.registryAddress;
    const ooAddress : string = savedAssertion.ooAddress;
    const collateralAddress : string = savedAssertion.collateralAddress;

    if (
        !registryAddress ||
        !ooAddress ||
        !collateralAddress
    ) {
        throw new Error(
            "selected assertion is missing contract addresses"
        );
    }

    if(!assertionId){
        throw new Error("assertion missing");
    }

    const registry = await ethers.getContractAt("IssuerTrustRegistry" , registryAddress);
    const oo = await ethers.getContractAt("IOptimisticOracleV3" , ooAddress);
    const collateral = await ethers.getContractAt("IERC20Benchmark" , collateralAddress);

    const signerAddress = await signer.getAddress();
    const collateralDecimals = await collateral.decimals();
    const collateralSymbol = await collateral.symbol();

    console.log("\nSETTLE ASSESSMENT\n");
    console.log("registry: " , registryAddress);
    console.log("OOV3: " , ooAddress);
    console.log("signer: " , signerAddress);
    console.log("assertionId: " , assertionId);

    //recupero informazioni

    const lookupStart = performance.now();

    const [ooAssertionBefore , assessmentBefore] = await Promise.all([
        oo.getAssertion(assertionId),
        registry.assessments(assertionId)
    ]);

    const lookupEnd = performance.now();
    const lookupTimeMs = lookupEnd - lookupStart;

    if (assessmentBefore.status == 0n) {
        throw new Error(
            "assertion is not registered in the current IssuerTrustRegistry"
        );
    }

    if (
        ooAssertionBefore.callbackRecipient.toLowerCase() !=
        registryAddress.toLowerCase()
    ) {
        throw new Error(
            "assertion callback recipient does not match the current registry"
        );
    }

    if (
        ooAssertionBefore.escalationManagerSettings.assertingCaller.toLowerCase() !=
        registryAddress.toLowerCase()
    ) {
        throw new Error(
            "assertion was not created by the current registry"
        );
    }

    if (
        ooAssertionBefore.currency.toLowerCase() !=
        collateralAddress.toLowerCase()
    ) {
        throw new Error(
            "assertion collateral does not match the expected collateral contract"
        );
    }


    console.log("\nBEFORE SETTLEMENT\n");
    console.log("registry status: " , statusName(assessmentBefore.status));
    console.log("asserter: " , ooAssertionBefore.asserter);
    console.log("disputer: " , ooAssertionBefore.disputer);
    console.log("settled: " , ooAssertionBefore.settled);
    console.log("settlement resolution: " , ooAssertionBefore.settlementResolution);
    console.log("bond: " , ethers.formatUnits(ooAssertionBefore.bond , collateralDecimals) , collateralSymbol);
    console.log("assertion time: " , new Date(Number(ooAssertionBefore.assertionTime) * 1000).toISOString());
    console.log("expiration time: " , new Date(Number(ooAssertionBefore.expirationTime) * 1000).toISOString());
    console.log("lookup time: " , lookupTimeMs , "ms");

    if(ooAssertionBefore.settled){
        console.log("assertion already settled");
        return;
    }

    const latestBlock = await ethers.provider.getBlock("latest");

    if(latestBlock == null){
        throw new Error("latest block not found");
    }

    if(
        ooAssertionBefore.disputer == ethers.ZeroAddress &&
        BigInt(latestBlock.timestamp) < ooAssertionBefore.expirationTime
    ){
        throw new Error("assertion not expired yet");
    }

    const collateralBalanceBefore = await collateral.balanceOf(signerAddress);

    //settlement on chain

    console.log("\nSETTLEMENT DIAGNOSTIC\n");

    console.log(
        "callback recipient:",
        ooAssertionBefore.callbackRecipient
    );

    console.log(
        "expected registry:",
        registryAddress
    );

    console.log(
        "asserting caller:",
        ooAssertionBefore.escalationManagerSettings.assertingCaller
    );

    console.log(
        "currency:",
        ooAssertionBefore.currency
    );

    const ooCollateralBalance =
        await collateral.balanceOf(ooAddress);

    console.log(
        "OOv3 collateral balance:",
        ethers.formatUnits(
            ooCollateralBalance,
            collateralDecimals
        ),
        collateralSymbol
    );

    const settleStart = performance.now();

    const settleTx = await registry.settleAssessment(assertionId);

    const settleSubmitted = performance.now();

    const receipt = await settleTx.wait();

    const settleConfirmed = performance.now();

    if(receipt == null){
        throw new Error("settlement receipt not found");
    }

    const submissionTimeMs = settleSubmitted - settleStart;
    const confirmationTimeMs = settleConfirmed - settleSubmitted;
    const totalTimeMs = settleConfirmed - settleStart;

    const feeWei = receipt.fee;
    const feeETH = ethers.formatEther(feeWei);

    //recupero informazioni

    const postLookupStart = performance.now();

    const [ooAssertionAfter , assessmentAfter] = await Promise.all([
        oo.getAssertion(assertionId),
        registry.assessments(assertionId)
    ]);

    const postLookupEnd = performance.now();
    const postLookupTimeMs = postLookupEnd - postLookupStart;

    const collateralBalanceAfter = await collateral.balanceOf(signerAddress);

     console.log("\nSETTLEMENT TRANSACTION\n");
    console.log("transaction: ", receipt.hash);
    console.log("block :", receipt.blockNumber);
    console.log("gas used: ", receipt.gasUsed.toString());
    console.log("fee: ", feeETH, "ETH");
    console.log("submission time: ", submissionTimeMs, "ms");
    console.log("confirmation time: ", confirmationTimeMs, "ms");
    console.log("total transaction time: ", totalTimeMs, "ms");

    console.log("\nAFTER SETTLEMENT\n");
    console.log("registry status: ", statusName(assessmentAfter.status));
    console.log("settled: ", ooAssertionAfter.settled);
    console.log("settlement resolution: ", ooAssertionAfter.settlementResolution);
    console.log("post-settlement lookup time: ", postLookupTimeMs, "ms");

    const collateralDelta = collateralBalanceAfter - collateralBalanceBefore;

    console.log("signer collateral balance before: " , ethers.formatUnits(collateralBalanceBefore , collateralDecimals) , collateralSymbol);
    console.log("signer collateral balance after: " , ethers.formatUnits(collateralBalanceAfter , collateralDecimals) , collateralSymbol);

    console.log("signer collateral delta: " , ethers.formatUnits(collateralDelta , collateralDecimals) , collateralSymbol);


    const settlementData = {
        network : networkName,
        registryAddress,
        ooAddress,
        assertionId,
        transactionHash : receipt.hash,
        blockNumber : receipt.blockNumber,
        gasUsed : receipt.gasUsed.toString(),
        feeWei : feeWei.toString(),
        feeETH,
        lookupBeforeSettlementTimeMs : lookupTimeMs,
        transactionSubmissionTimeMs : submissionTimeMs,
        transactionConfirmationTimeMs : confirmationTimeMs,
        transactionTotalTimeMs : totalTimeMs,
        lookupAfterSettlementTimeMs : postLookupTimeMs,
        statusBefore : statusName(assessmentBefore.status),
        statusAfter : statusName(assessmentAfter.status),
        settlementResolution : ooAssertionAfter.settlementResolution,
        disputed : ooAssertionBefore.disputer !== ethers.ZeroAddress,
        disputer : ooAssertionBefore.disputer,
        bond : ooAssertionBefore.bond.toString(),
        collateralSymbol : collateralSymbol,
        signerCollateralBalanceBefore : collateralBalanceBefore.toString(),
        signerCollateralBalanceAfter : collateralBalanceAfter.toString(),
        signerCollateralDelta : collateralDelta.toString()
    };

    store.assertions[assertionId].settlement = settlementData;
    store.assertions[assertionId].status = statusName(assessmentAfter.status);
    saveAssertionStore(store , networkName);

    const csvPath = `results/${networkName}-benchmark.csv`;

    const lookupRow = [
        "lookup",
        "get_assertion_before_settlement",
        assertionId,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        lookupTimeMs
    ].join(",") + "\n";

    const settlementRow = "settlement,settle_assessment," +
        assertionId + "," +
        receipt.hash + "," +
        receipt.blockNumber + "," +
        receipt.gasUsed.toString() + "," +
        feeWei.toString() + "," +
        feeETH + "," +
        submissionTimeMs + "," +
        confirmationTimeMs + "," +
        totalTimeMs + "\n";

    const postLookupRow = [
        "lookup",
        "get_assertion_after_settlement",
        assertionId,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        postLookupTimeMs
    ].join(",") + "\n";

    fs.appendFileSync(csvPath , lookupRow + settlementRow + postLookupRow);

    console.log(`\nsaved settlement data for network ${networkName}`);
    console.log(`appended settlement benchmark to 'results/${networkName}-benchmark.csv'`);

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

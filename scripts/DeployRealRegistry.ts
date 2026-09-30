import {network} from "hardhat";
import{performance} from "node:perf_hooks";
import fs from "node:fs";

async function main(){

    const connection = await network.create();

    const {ethers} = connection;

    const networkName = connection.networkName;

    const [deployer] = await ethers.getSigners();

    const OOV3_ADDRESS = process.env.OOV3_ADDRESS;

    if (!OOV3_ADDRESS) {
        throw new Error(
            "OOV3_ADDRESS environment variable is required"
        );
    }

    const COLLATERAL_ADDRESS =
        process.env.COLLATERAL_ADDRESS;

    if (!COLLATERAL_ADDRESS) {
        throw new Error(
            "COLLATERAL_ADDRESS environment variable is required"
        );
    }

    //liveness sperimentale: 600 secondi

    const ASSERTION_LIVENESS = 600;

    const CONFIGURED_BOND = 0n;

    console.log("deployer: " , await deployer.getAddress());

    console.log("OOv3: " , OOV3_ADDRESS);

    console.log("collateral: " , COLLATERAL_ADDRESS);

    console.log("configured liveness: " , ASSERTION_LIVENESS , "seconds");

    //deployed benchmark

    const start = performance.now();

    const registry = await ethers.deployContract(
        "IssuerTrustRegistry",
        [
            OOV3_ADDRESS,
            COLLATERAL_ADDRESS,
            ASSERTION_LIVENESS,
            CONFIGURED_BOND
        ]
    );

    //transazione inviata

    const sent = performance.now();

    const deploymentTx = registry.deploymentTransaction();

    if(deploymentTx == null){
        throw new Error("deployment transaction not found");
    }

    const receipt = await deploymentTx.wait();

    const confirmed = performance.now();

    if(receipt == null){
        throw new Error("deployment receipt not found");
    }

    const registryAddress = await registry.getAddress();

    //risultati

    const submissionTimeMs = sent - start;

    const confirmationTimeMs = confirmed - sent;

    const totalTimeMs = confirmed - start;

    const gasUsed = receipt.gasUsed;

    const feeWei = receipt.fee;

    const feeETH = ethers.formatEther(feeWei);

    console.log("\nDEPLOYMENT RESULT\n");
    console.log("registry: " , registryAddress);
    console.log("transaction: " , receipt.hash);
    console.log("block: " , receipt.blockNumber);
    console.log("gas used: " , gasUsed.toString());
    console.log("fee: " , feeETH);
    console.log("submission time: " , submissionTimeMs , "ms");
    console.log("confirmation time" , confirmationTimeMs , "ms");
    console.log("total time: " , totalTimeMs , "ms");

    if(!fs.existsSync("results")){
        fs.mkdirSync("results");
    }

    const deploymentData = {

        network : networkName,
        registryAddress : registryAddress,
        deployerAddress : await deployer.getAddress(),
        ooAddress : OOV3_ADDRESS,
        collateralAddress : COLLATERAL_ADDRESS,
        assertionLiveness : ASSERTION_LIVENESS,
        configuredBond : CONFIGURED_BOND.toString(),
        deploymentTransaction : receipt.hash,
        deploymentBlock : receipt.blockNumber,
        deploymentGasUsed : gasUsed.toString(),
        deploymentFeeWei : feeWei.toString(),
        deploymentFeeETH : feeETH,
        deploymentSubmissionTimeMs : submissionTimeMs,
        deploymentConfirmationTimeMs : confirmationTimeMs,
        deploymentTotalTimeMs : totalTimeMs
    }

    fs.writeFileSync(
        `results/${networkName}-deployment.json`,
        JSON.stringify(
            deploymentData,
            null,
            2
        )
    );

    //csv

    const csvPath = `results/${networkName}-benchmark.csv`;

    const csvHeader = "scenario,operation,assertionId,txHash,blockNumber,gasUsed,feeWei,feeETH,submissionTimeMs,confirmationTimeMs,totalTimeMs\n";

    const csvRow =
    "deployment," + 
    "registry_deployment,," + receipt.hash +
    "," + receipt.blockNumber +
    "," + gasUsed.toString() +
    "," + feeWei.toString() +
    "," + feeETH + 
    "," + submissionTimeMs +
    "," + confirmationTimeMs +
    "," + totalTimeMs + "\n";

    if(!fs.existsSync(csvPath)){
        fs.writeFileSync(csvPath , csvHeader + csvRow);
    }
    else{
        fs.appendFileSync(csvPath , csvRow);
    }

    console.log(`\nSaved deployed configuration to results/${networkName}-deployment.json`);
    console.log(`\nAppended benchmark result to results/${networkName}-benchmark.csv`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
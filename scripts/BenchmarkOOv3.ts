import {network} from "hardhat";
import {performance} from "node:perf_hooks";
import fs from "node:fs";
import { statistics } from "./utils/BenchmarkStats.js";

async function main(){

    const connection = await network.create();

    const {ethers} = connection;

    const networkName = connection.networkName;

    const signers = await ethers.getSigners();

    if(signers.length < 3){
        throw new Error(
            "benchmark requires at least three local accounts"
        );
    }

    const deployer = signers[0];

    // nel flusso SSI, l'holder agisce come asserter di UMA
    const asserter = signers[1];
    
    const disputer = signers[2];

    const OOV3_ADDRESS =
        process.env.OOV3_ADDRESS;

    if(!OOV3_ADDRESS){
        throw new Error(
            "OOV3_ADDRESS environment variable is required"
        );
    }

    const COLLATERAL_ADDRESS = process.env.COLLATERAL_ADDRESS;

    if(!COLLATERAL_ADDRESS){
        throw new Error(
            "COLLATERAL_ADDRESS environment variable is required"
        );
    }

    const MOCK_ORACLE_ADDRESS = process.env.MOCK_ORACLE_ADDRESS;

    if(!MOCK_ORACLE_ADDRESS){
        throw new Error(
            "MOCK_ORACLE_ADDRESS environment variable is required"
        );
    }

    const ASSERTION_LIVENESS = 600;

    const CONFIGURED_BOND = 0n;

    const VALIDITY_DURATION = 3600n;

    const RUNS = 30;

    const oo =
        await ethers.getContractAt(
            "IOptimisticOracleV3",
            OOV3_ADDRESS
        );

    const collateral =
        await ethers.getContractAt(
            "IERC20Benchmark",
            COLLATERAL_ADDRESS
        );

    const mockOracle =
        new ethers.Contract(
            MOCK_ORACLE_ADDRESS,
            [
                "function pushPrice(bytes32 identifier,uint256 time,bytes ancillaryData,int256 price)"
            ],
            deployer
        );

    const minimumBond =
        await oo.getMinimumBond(
            COLLATERAL_ADDRESS
        );

    type BenchmarkRow = {
        run: number;
        scenario: string;
        operation: string;
        submissionTimeMs: number;
        confirmationTimeMs: number;
        totalTimeMs: number;
        gasUsed: string;
        feeWei: string;
        transactionHash: string;
        assertionId: string;
    };

    const benchmarkRows: BenchmarkRow[] = [];

    const collateralDecimals =
        await collateral.decimals();

    const collateralSymbol =
        await collateral.symbol();

    const fundingAmount =
        ethers.parseUnits(
            "1000",
            collateralDecimals
        );

    const asserterAddress =
        await asserter.getAddress();

    const disputerAddress =
        await disputer.getAddress();

    const asserterBalanceBeforeFunding =
        await collateral.balanceOf(
            asserterAddress
        );

    const disputerBalanceBeforeFunding =
        await collateral.balanceOf(
            disputerAddress
        );

    if(
        asserterBalanceBeforeFunding <
        fundingAmount
    ){
        await(
            await collateral.allocateTo(
                asserterAddress,
                fundingAmount -
                asserterBalanceBeforeFunding
            )
        ).wait();
    }

    if(
        disputerBalanceBeforeFunding <
        fundingAmount
    ){
        await(
            await collateral.allocateTo(
                disputerAddress,
                fundingAmount -
                disputerBalanceBeforeFunding
            )
        ).wait();
    }

    const asserterBalance =
        await collateral.balanceOf(
            asserterAddress
        );

    const disputerBalance =
        await collateral.balanceOf(
            disputerAddress
        );

    console.log(
        "asserter collateral balance:",
        ethers.formatUnits(
            asserterBalance,
            collateralDecimals
        ),
        collateralSymbol
    );

    console.log(
        "disputer collateral balance:",
        ethers.formatUnits(
            disputerBalance,
            collateralDecimals
        ),
        collateralSymbol
    );

    const registry =
        await ethers.deployContract(
            "IssuerTrustRegistry",
            [
                OOV3_ADDRESS,
                COLLATERAL_ADDRESS,
                ASSERTION_LIVENESS,
                CONFIGURED_BOND
            ]
        );

    await registry.waitForDeployment();

    const registryAddress =
        await registry.getAddress();

    const totalAsserterAllowance =
        minimumBond *
        BigInt(RUNS * 3 + 1);

    const totalDisputerAllowance =
        minimumBond *
        BigInt(RUNS * 2 + 1);

    await(
        await collateral
            .connect(asserter)
            .approve(
                registryAddress,
                totalAsserterAllowance
            )
    ).wait();

    await(
        await collateral
            .connect(disputer)
            .approve(
                OOV3_ADDRESS,
                totalDisputerAllowance
            )
    ).wait();

    console.log(
        "\nOOv3 SANDBOX BENCHMARK\n"
    );

    console.log(
        "network:",
        networkName
    );

    console.log(
        "OOv3:",
        OOV3_ADDRESS
    );

    console.log(
        "collateral:",
        COLLATERAL_ADDRESS
    );

    console.log(
        "registry:",
        registryAddress
    );

    console.log(
        "minimum bond:",
        minimumBond.toString()
    );

    const claim =
        ethers.toUtf8Bytes(
            "Issuer is authorized to issue UniversityDegreeCredential"
        );

    const issuerDidHash =
        ethers.id(
            "did:example:unipi"
        );

    const credentialTypeHash =
        ethers.id(
            "UniversityDegreeCredential"
        );

    const BASE_POLICY =
        "MUR-2026";

    const evidenceHash =
        ethers.id(
            "benchmark-evidence"
        );

    for(let run = 0; run < RUNS; run++){

        console.log(
            "BENCHMARK RUN",
            run + 1,
            "OF",
            RUNS
        );

        const policyHash =
            ethers.id(
                BASE_POLICY +
                "-undisputed-" +
                run
            );

        const undisputedClaim =
            ethers.concat([
                claim,
                policyHash
            ]);

        const assertionStart =
            performance.now();

        const assertionTx =
            await registry
                .connect(asserter)
                .requestIssuerAssessment(
                    undisputedClaim,
                    issuerDidHash,
                    credentialTypeHash,
                    policyHash,
                    evidenceHash,
                    VALIDITY_DURATION
                );

        const assertionSubmitted =
            performance.now();

        const assertionReceipt =
            await assertionTx.wait();

        const assertionConfirmed =
            performance.now();

        if(assertionReceipt == null){
            throw new Error(
                "assertion receipt not found"
            );
        }

        const assertionSubmissionTimeMs = assertionSubmitted - assertionStart;

        const assertionConfirmationTimeMs = assertionConfirmed - assertionSubmitted;

        const assertionTotalTimeMs = assertionConfirmed - assertionStart;

        const assessmentKey =
            await registry.computeAssessmentKey(
                issuerDidHash,
                credentialTypeHash,
                policyHash
            );

        const assertionId =
            await registry.latestAssertionId(
                assessmentKey
            );

        benchmarkRows.push({
            run: run + 1,
            scenario: "undisputed",
            operation: "assertion",
            submissionTimeMs: assertionSubmissionTimeMs,
            confirmationTimeMs: assertionConfirmationTimeMs,
            totalTimeMs: assertionTotalTimeMs,
            gasUsed: assertionReceipt.gasUsed.toString(),
            feeWei: assertionReceipt.fee.toString(),
            transactionHash: assertionReceipt.hash,
            assertionId
        });

        console.log(
            "\nASSERTION CREATION RESULT\n"
        );

        console.log(
            "assertionId:",
            assertionId
        );

        console.log(
            "transaction:",
            assertionReceipt.hash
        );

        console.log(
            "gas used:",
            assertionReceipt.gasUsed.toString()
        );

        console.log(
            "fee:",
            ethers.formatEther(
                assertionReceipt.fee
            ),
            "ETH"
        );

        console.log(
            "submission time:",
            assertionSubmissionTimeMs,
            "ms"
        );

        console.log(
            "confirmation time:",
            assertionConfirmationTimeMs,
            "ms"
        );

        console.log(
            "total time:",
            assertionTotalTimeMs,
            "ms"
        );

        const assertion =
            await oo.getAssertion(
                assertionId
            );

        const latestBlock =
            await ethers.provider.getBlock(
                "latest"
            );

        if(latestBlock == null){
            throw new Error(
                "latest block not found"
            );
        }

        const secondsToAdvance =
            assertion.expirationTime -
            BigInt(latestBlock.timestamp) +
            1n;

        await ethers.provider.send(
            "evm_increaseTime",
            [
                Number(
                    secondsToAdvance
                )
            ]
        );

        await ethers.provider.send(
            "evm_mine",
            []
        );

        const settlementStart =
            performance.now();

        const settlementTx =
            await registry.settleAssessment(
                assertionId
            );

        const settlementSubmitted =
            performance.now();

        const settlementReceipt =
            await settlementTx.wait();

        const settlementConfirmed =
            performance.now();

        if(settlementReceipt == null){
            throw new Error(
                "settlement receipt not found"
            );
        }

        const settlementSubmissionTimeMs =
            settlementSubmitted -
            settlementStart;

        const settlementConfirmationTimeMs =
            settlementConfirmed -
            settlementSubmitted;

        const settlementTotalTimeMs =
            settlementConfirmed -
            settlementStart;

        benchmarkRows.push({
            run: run + 1,
            scenario: "undisputed",
            operation: "settlement",
            submissionTimeMs: settlementSubmissionTimeMs,
            confirmationTimeMs: settlementConfirmationTimeMs,
            totalTimeMs: settlementTotalTimeMs,
            gasUsed: settlementReceipt.gasUsed.toString(),
            feeWei: settlementReceipt.fee.toString(),
            transactionHash: settlementReceipt.hash,
            assertionId
        });

        console.log(
            "\nUNDISPUTED SETTLEMENT RESULT\n"
        );

        console.log(
            "transaction:",
            settlementReceipt.hash
        );

        console.log(
            "gas used:",
            settlementReceipt.gasUsed.toString()
        );

        console.log(
            "fee:",
            ethers.formatEther(
                settlementReceipt.fee
            ),
            "ETH"
        );

        console.log(
            "submission time:",
            settlementSubmissionTimeMs,
            "ms"
        );

        console.log(
            "confirmation time:",
            settlementConfirmationTimeMs,
            "ms"
        );

        console.log(
            "total time:",
            settlementTotalTimeMs,
            "ms"
        );

        const assessment =
            await registry.assessments(
                assertionId
            );

        if(assessment.status != 3n){
            throw new Error(
                "undisputed assessment did not become Trusted"
            );
        }

        console.log(
            "final status: Trusted"
        );

        const disputedPolicyHash =
            ethers.id(
                BASE_POLICY +
                "-disputed-true-" +
                run
            );

        const disputedClaim =
            ethers.concat([
                claim,
                disputedPolicyHash
            ]);

        const disputedAssertionStart =
            performance.now();

        const disputedAssertionTx =
            await registry
                .connect(asserter)
                .requestIssuerAssessment(
                    disputedClaim,
                    issuerDidHash,
                    credentialTypeHash,
                    disputedPolicyHash,
                    evidenceHash,
                    VALIDITY_DURATION
                );

        const disputedAssertionSubmitted =
            performance.now();

        const disputedAssertionReceipt =
            await disputedAssertionTx.wait();

        const disputedAssertionConfirmed =
            performance.now();

        if(disputedAssertionReceipt == null){
            throw new Error(
                "disputed assertion receipt not found"
            );
        }

        const disputedAssessmentKey =
            await registry.computeAssessmentKey(
                issuerDidHash,
                credentialTypeHash,
                disputedPolicyHash
            );

        const disputedAssertionId =
            await registry.latestAssertionId(
                disputedAssessmentKey
            );

        const disputedAssertionSubmissionTimeMs =
            disputedAssertionSubmitted -
            disputedAssertionStart;

        const disputedAssertionConfirmationTimeMs =
            disputedAssertionConfirmed -
            disputedAssertionSubmitted;

        const disputedAssertionTotalTimeMs =
            disputedAssertionConfirmed -
            disputedAssertionStart;

        benchmarkRows.push({
            run: run + 1,
            scenario: "disputed_true",
            operation: "assertion",
            submissionTimeMs: disputedAssertionSubmissionTimeMs,
            confirmationTimeMs: disputedAssertionConfirmationTimeMs,
            totalTimeMs: disputedAssertionTotalTimeMs,
            gasUsed: disputedAssertionReceipt.gasUsed.toString(),
            feeWei: disputedAssertionReceipt.fee.toString(),
            transactionHash: disputedAssertionReceipt.hash,
            assertionId: disputedAssertionId
        });

        const disputeStart =
            performance.now();

        const disputeTx =
            await oo
                .connect(disputer)
                .disputeAssertion(
                    disputedAssertionId,
                    disputerAddress
                );

        const disputeSubmitted =
            performance.now();

        const disputeReceipt =
            await disputeTx.wait();

        const disputeConfirmed =
            performance.now();

        if(disputeReceipt == null){
            throw new Error(
                "dispute receipt not found"
            );
        }

        const disputeSubmissionTimeMs =
            disputeSubmitted -
            disputeStart;

        const disputeConfirmationTimeMs =
            disputeConfirmed -
            disputeSubmitted;

        const disputeTotalTimeMs =
            disputeConfirmed -
            disputeStart;

        benchmarkRows.push({
            run: run + 1,
            scenario: "disputed_true",
            operation: "dispute",
            submissionTimeMs: disputeSubmissionTimeMs,
            confirmationTimeMs: disputeConfirmationTimeMs,
            totalTimeMs: disputeTotalTimeMs,
            gasUsed: disputeReceipt.gasUsed.toString(),
            feeWei: disputeReceipt.fee.toString(),
            transactionHash: disputeReceipt.hash,
            assertionId: disputedAssertionId
        });

        const disputedAssessment =
            await registry.assessments(
                disputedAssertionId
            );

        if(disputedAssessment.status != 2n){
            throw new Error(
                "assessment did not become Disputed"
            );
        }

        console.log(
            "\nDISPUTE RESULT\n"
        );

        console.log(
            "assertionId:",
            disputedAssertionId
        );

        console.log(
            "assertion gas used:",
            disputedAssertionReceipt.gasUsed.toString()
        );

        console.log(
            "assertion total time:",
            disputedAssertionTotalTimeMs,
            "ms"
        );

        console.log(
            "dispute transaction:",
            disputeReceipt.hash
        );

        console.log(
            "dispute gas used:",
            disputeReceipt.gasUsed.toString()
        );

        console.log(
            "dispute fee:",
            ethers.formatEther(
                disputeReceipt.fee
            ),
            "ETH"
        );

        console.log(
            "dispute submission time:",
            disputeSubmissionTimeMs,
            "ms"
        );

        console.log(
            "dispute confirmation time:",
            disputeConfirmationTimeMs,
            "ms"
        );

        console.log(
            "dispute total time:",
            disputeTotalTimeMs,
            "ms"
        );

        console.log(
            "final status: Disputed"
        );

        const disputedOOAssertion =
            await oo.getAssertion(
                disputedAssertionId
            );

        const disputedAncillaryData =
            await oo.stampAssertion(
                disputedAssertionId
            );

        await(
            await mockOracle.pushPrice(
                disputedOOAssertion.identifier,
                disputedOOAssertion.assertionTime,
                disputedAncillaryData,
                ethers.parseEther("1")
            )
        ).wait();

        const disputedSettlementStart = performance.now();

        const disputedSettlementTx =
            await registry.settleAssessment(
                disputedAssertionId
            );

        const disputedSettlementSubmitted =
            performance.now();

        const disputedSettlementReceipt =
            await disputedSettlementTx.wait();

        const disputedSettlementConfirmed =
            performance.now();

        if(disputedSettlementReceipt == null){
            throw new Error(
                "disputed settlement receipt not found"
            );
        }

        const disputedSettlementSubmissionTimeMs =
            disputedSettlementSubmitted -
            disputedSettlementStart;

        const disputedSettlementConfirmationTimeMs =
            disputedSettlementConfirmed -
            disputedSettlementSubmitted;

        const disputedSettlementTotalTimeMs =
            disputedSettlementConfirmed -
            disputedSettlementStart;

        benchmarkRows.push({
            run: run + 1,
            scenario: "disputed_true",
            operation: "settlement",
            submissionTimeMs: disputedSettlementSubmissionTimeMs,
            confirmationTimeMs: disputedSettlementConfirmationTimeMs,
            totalTimeMs: disputedSettlementTotalTimeMs,
            gasUsed: disputedSettlementReceipt.gasUsed.toString(),
            feeWei: disputedSettlementReceipt.fee.toString(),
            transactionHash: disputedSettlementReceipt.hash,
            assertionId: disputedAssertionId
        });

        const resolvedDisputedAssessment =
            await registry.assessments(
                disputedAssertionId
            );

        if(resolvedDisputedAssessment.status != 3n){
            throw new Error(
                "disputed assessment did not become Trusted"
            );
        }

        console.log("\nDISPUTED SETTLEMENT TRUE RESULT\n");

        console.log(
            "transaction:",
            disputedSettlementReceipt.hash
        );

        console.log(
            "gas used:",
            disputedSettlementReceipt.gasUsed.toString()
        );

        console.log(
            "fee:",
            ethers.formatEther(
                disputedSettlementReceipt.fee
            ),
            "ETH"
        );

        console.log(
            "submission time:",
            disputedSettlementSubmissionTimeMs,
            "ms"
        );

        console.log(
            "confirmation time:",
            disputedSettlementConfirmationTimeMs,
            "ms"
        );

        console.log(
            "total time:",
            disputedSettlementTotalTimeMs,
            "ms"
        );

        console.log(
            "final status: Trusted"
        );


        const rejectedPolicy = BASE_POLICY + "-disputed-false-" + run;

        const rejectedPolicyHash =
            ethers.id(
                rejectedPolicy
            );

        const rejectedClaim =
            ethers.concat([
                claim,
                rejectedPolicyHash
            ]);

        const rejectedAssertionStart = performance.now();

        const rejectedAssertionTx =
            await registry
                .connect(asserter)
                .requestIssuerAssessment(
                    rejectedClaim,
                    issuerDidHash,
                    credentialTypeHash,
                    rejectedPolicyHash,
                    evidenceHash,
                    VALIDITY_DURATION
                );

        const rejectedAssertionSubmitted =
            performance.now();

        const rejectedAssertionReceipt =
            await rejectedAssertionTx.wait();

        const rejectedAssertionConfirmed =
            performance.now();

        if(rejectedAssertionReceipt == null){
            throw new Error(
                "rejected assertion receipt not found"
            );
        }

        const rejectedAssertionSubmissionTimeMs =
            rejectedAssertionSubmitted -
            rejectedAssertionStart;

        const rejectedAssertionConfirmationTimeMs =
            rejectedAssertionConfirmed -
            rejectedAssertionSubmitted;

        const rejectedAssertionTotalTimeMs =
            rejectedAssertionConfirmed -
            rejectedAssertionStart;

        const rejectedAssessmentKey =
            await registry.computeAssessmentKey(
                issuerDidHash,
                credentialTypeHash,
                rejectedPolicyHash
            );

        const rejectedAssertionId =
            await registry.latestAssertionId(
                rejectedAssessmentKey
            );

        benchmarkRows.push({
            run: run + 1,
            scenario: "disputed_false",
            operation: "assertion",
            submissionTimeMs: rejectedAssertionSubmissionTimeMs,
            confirmationTimeMs: rejectedAssertionConfirmationTimeMs,
            totalTimeMs: rejectedAssertionTotalTimeMs,
            gasUsed: rejectedAssertionReceipt.gasUsed.toString(),
            feeWei: rejectedAssertionReceipt.fee.toString(),
            transactionHash: rejectedAssertionReceipt.hash,
            assertionId: rejectedAssertionId
        });

        const rejectedDisputeStart = performance.now();

        const rejectedDisputeTx =
            await oo
                .connect(disputer)
                .disputeAssertion(
                    rejectedAssertionId,
                    disputerAddress
                );

        const rejectedDisputeSubmitted =
            performance.now();

        const rejectedDisputeReceipt =
            await rejectedDisputeTx.wait();

        const rejectedDisputeConfirmed =
            performance.now();

        if(rejectedDisputeReceipt == null){
            throw new Error(
                "rejected dispute receipt not found"
            );
        }

        const rejectedDisputeSubmissionTimeMs =
            rejectedDisputeSubmitted -
            rejectedDisputeStart;

        const rejectedDisputeConfirmationTimeMs =
            rejectedDisputeConfirmed -
            rejectedDisputeSubmitted;

        const rejectedDisputeTotalTimeMs =
            rejectedDisputeConfirmed -
            rejectedDisputeStart;

        benchmarkRows.push({
            run: run + 1,
            scenario: "disputed_false",
            operation: "dispute",
            submissionTimeMs: rejectedDisputeSubmissionTimeMs,
            confirmationTimeMs: rejectedDisputeConfirmationTimeMs,
            totalTimeMs: rejectedDisputeTotalTimeMs,
            gasUsed: rejectedDisputeReceipt.gasUsed.toString(),
            feeWei: rejectedDisputeReceipt.fee.toString(),
            transactionHash: rejectedDisputeReceipt.hash,
            assertionId: rejectedAssertionId
        });

        const rejectedDisputedAssessment =
            await registry.assessments(
                rejectedAssertionId
            );

        if(rejectedDisputedAssessment.status != 2n){
            throw new Error(
                "rejected assessment did not become Disputed"
            );
        }

        const rejectedOOAssertion =
            await oo.getAssertion(
                rejectedAssertionId
            );

        const rejectedAncillaryData =
            await oo.stampAssertion(
                rejectedAssertionId
            );

        await(
            await mockOracle.pushPrice(
                rejectedOOAssertion.identifier,
                rejectedOOAssertion.assertionTime,
                rejectedAncillaryData,
                0n
            )
        ).wait();

        const rejectedSettlementStart = performance.now();

        const rejectedSettlementTx =
            await registry.settleAssessment(
                rejectedAssertionId
            );

        const rejectedSettlementSubmitted =
            performance.now();

        const rejectedSettlementReceipt =
            await rejectedSettlementTx.wait();

        const rejectedSettlementConfirmed =
            performance.now();

        if(rejectedSettlementReceipt == null){
            throw new Error(
                "rejected settlement receipt not found"
            );
        }

        const rejectedSettlementSubmissionTimeMs =
            rejectedSettlementSubmitted -
            rejectedSettlementStart;

        const rejectedSettlementConfirmationTimeMs =
            rejectedSettlementConfirmed -
            rejectedSettlementSubmitted;

        const rejectedSettlementTotalTimeMs =
            rejectedSettlementConfirmed -
            rejectedSettlementStart;

        benchmarkRows.push({
            run: run + 1,
            scenario: "disputed_false",
            operation: "settlement",
            submissionTimeMs: rejectedSettlementSubmissionTimeMs,
            confirmationTimeMs: rejectedSettlementConfirmationTimeMs,
            totalTimeMs: rejectedSettlementTotalTimeMs,
            gasUsed: rejectedSettlementReceipt.gasUsed.toString(),
            feeWei: rejectedSettlementReceipt.fee.toString(),
            transactionHash: rejectedSettlementReceipt.hash,
            assertionId: rejectedAssertionId
        });

        const resolvedRejectedAssessment =
            await registry.assessments(
                rejectedAssertionId
            );

        if(resolvedRejectedAssessment.status != 4n){
            throw new Error(
                "assessment did not become Rejected"
            );
        }

        console.log("\nDISPUTED SETTLEMENT FALSE RESULT\n");

        console.log(
            "assertionId:",
            rejectedAssertionId
        );

        console.log(
            "assertion gas used:",
            rejectedAssertionReceipt.gasUsed.toString()
        );

        console.log(
            "assertion total time:",
            rejectedAssertionTotalTimeMs,
            "ms"
        );

        console.log(
            "dispute gas used:",
            rejectedDisputeReceipt.gasUsed.toString()
        );

        console.log(
            "dispute fee:",
            ethers.formatEther(
                rejectedDisputeReceipt.fee
            ),
            "ETH"
        );

        console.log(
            "dispute submission time:",
            rejectedDisputeSubmissionTimeMs,
            "ms"
        );

        console.log(
            "dispute confirmation time:",
            rejectedDisputeConfirmationTimeMs,
            "ms"
        );

        console.log(
            "dispute total time:",
            rejectedDisputeTotalTimeMs,
            "ms"
        );

        console.log(
            "settlement gas used:",
            rejectedSettlementReceipt.gasUsed.toString()
        );

        console.log(
            "settlement fee:",
            ethers.formatEther(
                rejectedSettlementReceipt.fee
            ),
            "ETH"
        );

        console.log(
            "settlement submission time:",
            rejectedSettlementSubmissionTimeMs,
            "ms"
        );

        console.log(
            "settlement confirmation time:",
            rejectedSettlementConfirmationTimeMs,
            "ms"
        );

        console.log(
            "settlement total time:",
            rejectedSettlementTotalTimeMs,
            "ms"
        );

        console.log(
            "final status: Rejected"
        );

    }

    if(benchmarkRows.length != RUNS * 8){
        throw new Error(
            `unexpected benchmark row count: ${benchmarkRows.length}`
        );
    }

    const csvHeader = [
        "run",
        "scenario",
        "operation",
        "submissionTimeMs",
        "confirmationTimeMs",
        "totalTimeMs",
        "gasUsed",
        "feeWei",
        "transactionHash",
        "assertionId"
    ].join(",");

    const csvRows =
        benchmarkRows.map((row) =>
            [
                row.run,
                row.scenario,
                row.operation,
                row.submissionTimeMs,
                row.confirmationTimeMs,
                row.totalTimeMs,
                row.gasUsed,
                row.feeWei,
                row.transactionHash,
                row.assertionId
            ].join(",")
        );

    fs.mkdirSync(
        "results",
        {recursive: true}
    );

    fs.writeFileSync(
        "results/oov3-benchmark.csv",
        [
            csvHeader,
            ...csvRows
        ].join("\n")
    );

    const groups = [
        ["undisputed", "assertion"],
        ["undisputed", "settlement"],

        ["disputed_true", "assertion"],
        ["disputed_true", "dispute"],
        ["disputed_true", "settlement"],

        ["disputed_false", "assertion"],
        ["disputed_false", "dispute"],
        ["disputed_false", "settlement"]
    ] as const;


    console.log(
        "OOv3 BENCHMARK SUMMARY"
    );

    console.log(
        "runs:",
        RUNS
    );

    for(const [scenario, operation] of groups){
        const rows =
            benchmarkRows.filter(
                (row) =>
                    row.scenario == scenario &&
                    row.operation == operation
            );

        const totalTimeStats =
            statistics(
                rows.map(
                    (row) =>
                        row.totalTimeMs
                )
            );

        const gasStats =
            statistics(
                rows.map(
                    (row) =>
                        Number(row.gasUsed)
                )
            );

        const feeStats =
            statistics(
                rows.map(
                    (row) =>
                        Number(row.feeWei)
                )
            );

        console.log(
            `\n${scenario} / ${operation}`
        );

        console.log(
            "total time ms:",
            totalTimeStats
        );

        console.log(
            "gas used:",
            gasStats
        );

        console.log(
            "fee wei:",
            feeStats
        );
    }

    console.log("\nCSV saved to results/oov3-benchmark.csv");

}


main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
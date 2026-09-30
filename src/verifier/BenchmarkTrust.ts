import {network} from "hardhat";
import{performance} from "node:perf_hooks";
import{agent} from "../veramo/setup.js";
import { verifyCredentialWithTrust } from "./verifyCredentialWithTrust.js";
import { statistics } from "../../scripts/utils/BenchmarkStats.js";
import fs from "node:fs";

async function main(){

    const {ethers , networkHelpers} = await network.create();
    const [, asserter] = await ethers.getSigners();
    const minimumBond = ethers.parseUnits("100" , 6);
    const initialBalance = ethers.parseUnits("1000" , 6);
    const liveness = 120;
    const runs = 1000;
    const warmupRuns = 20;


    //creazione DID

    const issuer = await agent.didManagerCreate({
        provider : "did:key",
        alias : "university"
    });

    const subject = await agent.didManagerCreate({
        provider : "did:key",
        alias : "student"
    });

    //creazione verifiable credential

    const credential = await agent.createVerifiableCredential({
        credential : {
            issuer : {id : issuer.did},
            type : [
                "VerifiableCredential",
                "UniversityDegreeCredential"
            ],
            issuanceDate : new Date().toISOString(),
            credentialSubject : {
                id : subject.did,
                degree : {
                    type : "masterDegree",
                    name : "Master Degree"
                }
            }
        },
        proofFormat : "jwt",
        save : false
    });

    //deploy trust registry locale

    const collateral = await ethers.deployContract("MockERC20");

    const mockOO = await ethers.deployContract("MockOptimisticOracleV3" , [minimumBond]);

    const registry = await ethers.deployContract("IssuerTrustRegistry" , [
        await mockOO.getAddress(),
        await collateral.getAddress(),
        liveness,
        minimumBond
    ]);

    //creazione di assessment già trusted

    await(
        await collateral.mint(
            await asserter.getAddress(),
            initialBalance
        )
    ).wait();

    await(
        await collateral.connect(asserter).approve(
            await registry.getAddress(),
            minimumBond
        )
    ).wait();

    const issuerDidHash = ethers.id(issuer.did);
    const credentialTypeHash = ethers.id("UniversityDegreeCredential");
    const policyHash = ethers.id("MUR-2026");
    const evidenceHash = ethers.id("benchmark-evidence");
    const claim = ethers.toUtf8Bytes("issuer is authorized to issue UniversityDegreeCredential");

    const validityDuration = 3600n;

    //creazione assertion

    await(
        await registry.connect(asserter).requestIssuerAssessment(
            claim,
            issuerDidHash,
            credentialTypeHash,
            policyHash,
            evidenceHash,
            validityDuration
        )
    ).wait();

    const assessmentKey = await registry.computeAssessmentKey(
        issuerDidHash,
        credentialTypeHash,
        policyHash
    )

    const assertionId = await registry.latestAssertionId(assessmentKey);

    const mockAssertion = await mockOO.Assertions(assertionId);

    await networkHelpers.time.increaseTo(mockAssertion.expirationTime + 1n);

    await(
        (await registry.settleAssessment(assertionId))
    ).wait();

    const valid = await registry.isAssessmentValid(assertionId);

    if(!valid){
        throw new Error("trusted assessment setup failed");
    }

    console.log("\ntrusted assessment created\n");

    //warmup

    for(let i = 0 ; i < warmupRuns ; i++){

        await agent.verifyCredential({credential});

        const result = await registry.getLatestAssessment(
            issuerDidHash,
            credentialTypeHash,
            policyHash
        );

        await registry.isAssessmentValid(result[0]);

        await verifyCredentialWithTrust(
            credential,
            registry,
            "MUR-2026"
        );
    }

    //benchmark VC

    const vcTimes : number[] = [];

    for(let i = 0 ; i < runs ; i++){

        const start = performance.now();

        const verification = await agent.verifyCredential({credential});

        const end = performance.now();

        if(!verification.verified){
            throw new Error("VC verification failed");
        }

        vcTimes.push(end - start);
    }

    //benchmark trust lookup

    const trustTimes : number[] = [];

    for(let i = 0 ; i < runs ; i++){

        const start = performance.now();

        const result = await registry.getLatestAssessment(
            issuerDidHash,
            credentialTypeHash,
            policyHash
        );

        const assertionId = result[0];

        const valid = await registry.isAssessmentValid(assertionId);

        const end = performance.now();

        if(!valid){
            throw new Error("issuer assessment is not valid");
        }

        trustTimes.push(end - start);
    }

    //benchmark trust lookup + VC

    const combinedTimes : number[] = [];

    for(let i = 0 ; i < runs ; i++){

        const start = performance.now();

        const result = await verifyCredentialWithTrust(
            credential,
            registry,
            "MUR-2026"
        );

        const end = performance.now();

        if(!result.vcVerified){
            throw new Error("vc verification failed");
        }

        if(!result.trusted){
            throw new Error(
                "issuer assessment is not trusted"
            );
        }

        combinedTimes.push(end - start);
    }


    const vcStats = statistics(vcTimes);
    const trustStats = statistics(trustTimes);
    const combinedStats = statistics(combinedTimes);

    const additionalTime = combinedStats.average - vcStats.average;
    const overhead = additionalTime / vcStats.average * 100;

    const expectedCombined = vcStats.average + trustStats.average;

    const interactionOverhead = combinedStats.average - expectedCombined;

    console.log(
        "\n=== VC + TRUST BENCHMARK ===\n"
    );

    console.log("Runs:", runs);

    console.log(
        "\nVC ONLY"
    );

    console.log(
        "Average:",
        vcStats.average,
        "ms"
    );

    console.log(
        "Median:",
        vcStats.median,
        "ms"
    );

    console.log(
        "Standard deviation:",
        vcStats.standardDeviation,
        "ms"
    );

    console.log(
        "p95:",
        vcStats.p95,
        "ms"
    );

    console.log(
        "Min:",
        vcStats.min,
        "ms"
    );

    console.log(
        "Max:",
        vcStats.max,
        "ms"
    );


    console.log(
        "\nTRUST LOOKUP ONLY"
    );

    console.log(
        "Average:",
        trustStats.average,
        "ms"
    );

    console.log(
        "Median:",
        trustStats.median,
        "ms"
    );
    console.log(
        "Standard deviation:",
        trustStats.standardDeviation,
        "ms"
    );

    console.log(
        "p95:",
        trustStats.p95,
        "ms"
    );

    console.log(
        "Min:",
        trustStats.min,
        "ms"
    );

    console.log(
        "Max:",
        trustStats.max,
        "ms"
    );


    console.log(
        "\nVC + TRUST"
    );

    console.log(
        "Average:",
        combinedStats.average,
        "ms"
    );

    console.log(
        "Median:",
        combinedStats.median,
        "ms"
    );

    console.log(
        "Standard deviation:",
        combinedStats.standardDeviation,
        "ms"
    );

    console.log(
        "p95:",
        combinedStats.p95,
        "ms"
    );

    console.log(
        "Min:",
        combinedStats.min,
        "ms"
    );

    console.log(
        "Max:",
        combinedStats.max,
        "ms"
    );


    console.log(
        "\nAdditional average time:",
        additionalTime,
        "ms"
    );

    console.log(
        "Temporal overhead:",
        overhead,
        "%"
    );

    console.log(
        "Expected VC + trust from separate averages:",
        expectedCombined,
        "ms"
    );

    console.log(
        "Combined-path interaction overhead:",
        interactionOverhead,
        "ms"
    );

    const output = {
        runs,
        warmupRuns,
        vcOnly: vcStats,
        trustLookupOnly: trustStats,
        vcPlusTrust: combinedStats,
        additionalTimeMs: additionalTime,
        overheadPercent: overhead,
        expectedCombinedMs: expectedCombined,
        interactionOverheadMs: interactionOverhead
    };

    fs.mkdirSync(
        "results",
        { recursive: true }
    );


    fs.writeFileSync(
        "results/benchmark-trust.json",
        JSON.stringify(
            output,
            null,
            2
        )
    );

    const csvHeader = [
        "sample",
        "vcVerificationMs",
        "trustLookupMs",
        "vcAndTrustMs"
    ].join(",");

    const csvRows = [];

    for(let i = 0; i < runs; i++){

        csvRows.push(
            [
                i + 1,
                vcTimes[i],
                trustTimes[i],
                combinedTimes[i]
            ].join(",")
        );
    }

    fs.writeFileSync(
        "results/trust-benchmark.csv",
        [
            csvHeader,
            ...csvRows
        ].join("\n")
    );

    console.log("\nCSV saved to results/trust-benchmark.csv");
}


main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

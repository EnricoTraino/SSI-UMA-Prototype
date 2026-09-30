import {agent} from "./setup.js";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main(){

    //creazione DID dell'issuer

    const issuer = await agent.didManagerCreate({
        provider: "did:key",
        alias: "university"
    });

    //creazione did del soggetto

    const subject = await agent.didManagerCreate({
        provider: "did:key",
        alias: "student"
    });

    console.log("issuer DID: " , issuer.did);
    console.log("\nsubject DID: " , subject.did);

    //emissione della verifiable credential


    const credential = await agent.createVerifiableCredential({
        credential: {
            issuer: {id: issuer.did},
            type: [
                "VerifiableCredential",
                "UniversityDegreeCredential"
            ],
            issuanceDate: new Date().toISOString(),
            credentialSubject: {
                id: subject.did,
                degree: {
                    type: "masterDegree",
                    name: "Master Degree"
                }
            }
        },
        proofFormat: "jwt",
        save: false
    });

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const resultsDir = path.resolve(__dirname, "../../results");
    const vcPath = path.join(resultsDir, "test-vc.json");

    fs.mkdirSync(resultsDir, { recursive: true });

    fs.writeFileSync(
        vcPath,
        JSON.stringify(
            {
                issuerDid: issuer.did,
                subjectDid: subject.did,
                credential
            },
            null,
            2
        )
    );

    console.log("\nVC saved to:", vcPath);

    console.log("\nverifiable credential: " , JSON.stringify(credential , null , 2));

    //verifica della credential

    const warmupRuns = 5;

    for (let i = 0; i < warmupRuns; i++) {
        const verification =
            await agent.verifyCredential({
                credential
            });

        if (!verification.verified) {
            throw new Error(
                "Credential verification failed during warm-up"
            );
        }
    }

    const verificationTimes : number[] = [];

    for(let i = 0; i < 50 ; i++){

        const start = performance.now();

        const verification = await agent.verifyCredential({credential});

        const end = performance.now();

        if(!verification.verified){
            throw new Error("credential verification failed");
        }

        verificationTimes.push(end - start);
    }

    const average = verificationTimes.reduce(
        (sum,value) => sum + value , 0
    ) / verificationTimes.length;

    const minimum = Math.min(...verificationTimes);
    const maximum = Math.max(...verificationTimes);
    const sortedTimes = [...verificationTimes].sort((a,b) => a-b);
    const middle = Math.floor(sortedTimes.length/2);
    const median = (sortedTimes[middle - 1] + sortedTimes[middle]) / 2;


    console.log("\nVC VERIFICATION BENCHMARK\n");
    console.log("runs: " , verificationTimes.length);
    console.log("average: " , average);
    console.log("median: " , median);
    console.log("minimum: " , minimum);
    console.log("maximum: " , maximum);

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
})
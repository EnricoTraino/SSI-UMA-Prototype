import {network} from "hardhat";
import {performance} from "node:perf_hooks";
import fs from "node:fs";
import {agent} from "../src/veramo/setup.js";
import { requestIssuerAssessmentAsHolder } from "../src/holder/requestIssuerAssessment.js";
import {loadAssertionStore , saveAssertionStore} from "./utils/assertionStore.js";
import { verifyCredentialWithTrust } from "../src/verifier/verifyCredentialWithTrust.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main(){

    const connection = await network.create();

    const {ethers} = connection;

    const networkName = connection.networkName;

    const deployment = JSON.parse(fs.readFileSync(`results/${networkName}-deployment.json` , "utf8"));

    const registry = await ethers.getContractAt(
        "IssuerTrustRegistry",
        deployment.registryAddress
    );


    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const vcPath = path.resolve(
        __dirname,
        "../results/test-vc.json"
    );

    if(!fs.existsSync(vcPath)){
        throw new Error("run testVC.ts first");
    }

    const savedVc = JSON.parse(fs.readFileSync(vcPath , "utf8"));

    const credential = savedVc.credential;

    if(!credential){
        throw new Error("credential missing from 'results/test-vc.json'");
    }

    console.log(
        "\nLoaded VC issued by:",
        savedVc.issuerDid
    );

    const policy = "SSI-UMA-TEST-2026";

    const verifierStart = performance.now();

    const existingTrust = await verifyCredentialWithTrust(
        credential,
        registry,
        policy
    );

    const verifierEnd = performance.now();
    const verifierTimeMs = verifierEnd - verifierStart;

    if (existingTrust.reason == "VC_INVALID") {
        console.log("\nVC INVALID");
        return;
    }

    if (existingTrust.reason == "TRUSTED") {
        console.log("\nEXISTING TRUSTED ASSESSMENT FOUND");
        console.log("issuer DID:", existingTrust.issuerDid);
        console.log("credential type:", existingTrust.credentialType);
        console.log("assertion ID:", existingTrust.assertionId);
        return;
    }

    if (existingTrust.reason == "ASSESSMENT_NOT_VALID") {
        console.log("\nEXISTING ASSESSMENT FOUND, BUT NOT VALID");
        console.log("issuer DID:", existingTrust.issuerDid);
        console.log("credential type:", existingTrust.credentialType);
        console.log("assertion ID:", existingTrust.assertionId);

        if ("status" in existingTrust) {
            console.log("status:", existingTrust.status);
        }


        console.log("verifier time: " , verifierTimeMs , "ms");
        return;
    }

    if(existingTrust.reason != "NO_ASSESSMENT"){
        throw new Error(`Unexpected trust result: ${existingTrust.reason}`);
    }

    const requestPath = path.resolve(
        __dirname,
        "../results/assessment-request.json"
    );

    const assessmentRequest = {
        issuerDid: existingTrust.issuerDid,
        credentialType: existingTrust.credentialType,
        policy
    };

    fs.writeFileSync(
        requestPath,
        JSON.stringify(
            assessmentRequest,
            null,
            2
        )
    );

    console.log("\nNO ASSESSMENT FOUND");

    console.log(
        "issuer DID:",
        existingTrust.issuerDid
    );

    console.log(
        "credential type:",
        existingTrust.credentialType
    );

    console.log(
        "policy:",
        policy
    );

    console.log(
        "Verifier time:",
        verifierTimeMs,
        "ms"
    );

    console.log(
        "\nAssessment request saved to:",
        requestPath
    );
}
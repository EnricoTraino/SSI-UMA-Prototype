import fs from "node:fs";
import readline from "node:readline/promises";
import {stdin as input , stdout as output} from "node:process";

export type assertionStore = {
    latestAssertionId : string | null;
    assertions : Record<string , any>;
}

function getAssertionsPath(networkName: string) {
    return `results/${networkName}-assertion.json`;
}

export function loadAssertionStore(networkName : string) : assertionStore{

    const ASSERTIONS_PATH = getAssertionsPath(networkName);

    if (!fs.existsSync(ASSERTIONS_PATH)) {
    return {
        latestAssertionId: null,
        assertions: {}
    };
}

    const content =
        fs.readFileSync(
            ASSERTIONS_PATH,
            "utf8"
        ).trim();

    if (content.length === 0) {
        return {
            latestAssertionId: null,
            assertions: {}
        };
    }

    const parsed = JSON.parse(content);

    if (
        typeof parsed != "object" ||
        parsed == null ||
        Array.isArray(parsed)
    ) {
        throw new Error(
            "invalid assertion store structure"
        );
    }

    if (typeof parsed.assertionId === "string") {
        return {
            latestAssertionId:
                parsed.assertionId,

            assertions: {
                [parsed.assertionId]:
                    parsed
            }
        };
    }

    if (
        typeof parsed.assertions != "object" ||
        parsed.assertions == null ||
        Array.isArray(parsed.assertions)
    ) {
        throw new Error(
            "invalid assertion store structure"
        );
    }


    return parsed;
}

export function saveAssertionStore(store : assertionStore , networkName : string){

    const ASSERTIONS_PATH = getAssertionsPath(networkName);
    fs.writeFileSync(ASSERTIONS_PATH , JSON.stringify(store , null , 2));
}

export async function selectAssertion(networkName : string ){

    const store = loadAssertionStore(networkName);

    if(!store.latestAssertionId || Object.keys(store.assertions).length == 0){
        throw new Error("no assertions available");
    }

    let requestedAssertionId = process.env.ASSERTION_ID?.trim();

    if(!requestedAssertionId){
        const rl = readline.createInterface({input , output});

        const answer = await rl.question( `\nASSERTION ID [ENTER = latest ${store.latestAssertionId}]: `);

        rl.close();

        requestedAssertionId = answer.trim() || store.latestAssertionId;
    }

    const actualAssertionId = Object.keys(store.assertions).find(id => 
        id.toLowerCase() == requestedAssertionId!.toLowerCase()
    );

    if (!actualAssertionId) {
        throw new Error(
            "assertionId not found in local assertion history"
        );
    }

    return {
        store,
        assertionId: actualAssertionId,
        assertion:
            store.assertions[
                actualAssertionId
            ]
    };
}
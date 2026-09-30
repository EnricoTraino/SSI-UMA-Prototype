import {id} from "ethers";
import {agent} from "../veramo/setup.js";

export async function verifyCredentialWithTrust(credential : any , registry : any , policy : string){

    //verifica crittografica della VC

    const verification = await agent.verifyCredential({credential});

    if(!verification.verified){
        return{
            vcVerified : false,
            trusted : false,
            reason : "VC_INVALID"
        }
    }

    
    const verifiedCredential = verification.verifiableCredential;

    //estrazione issuer did

    const issuer = verification.issuer;

    const issuerDid =
        typeof issuer == "string"
            ? issuer
            : issuer.id;

    if(!issuerDid){
        throw new Error("Issuer id not found");
    }

    //estrazione credential type


    const types = Array.isArray(verifiedCredential.type)
    ?verifiedCredential.type
    : [verifiedCredential.type];

    const credentialType = types.find((type : string) => type != "VerifiableCredential");

    if(!credentialType){
        throw new Error("credential type not found");
    }

    //hash dei dati per il registry

    const issuerDidHash = id(issuerDid);
    const credentialTypeHash = id(credentialType);
    const policyHash = id(policy);

    //lookup dell'assessment

    try{

        const result = await registry.getLatestAssessment(
            issuerDidHash,
            credentialTypeHash,
            policyHash
        );

        const assertionId = result[0];
        const assessment = result[1];

        //controllo trust e scadenza

        const valid = await registry.isAssessmentValid(assertionId);

        if(!valid){
            return {
                vcVerified : true,
                trusted : false,
                reason : "ASSESSMENT_NOT_VALID",
                issuerDid,
                credentialType,
                assertionId,
                status : assessment.status
            }
        }

        return {
            vcVerified : true,
            trusted : true,
            reason : "TRUSTED",
            issuerDid,
            credentialType,
            assertionId,
            status : assessment.status
        }
    }catch(error){
        
        const message = error instanceof Error
        ? error.message
        : String(error);

        if(message.includes("assessment not found")){
            return{
                vcVerified : true,
                trusted : false,
                reason : "NO_ASSESSMENT",
                assessmentRequest : {
                    issuerDid,
                    credentialType,
                    policy
                }
            }
        }
        throw error;
    }
}